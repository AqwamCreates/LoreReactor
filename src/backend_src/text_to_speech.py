import os
import sys
import base64
import io
import torch
import soundfile
import librosa
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["DISABLE_TELEMETRY"] = "YES"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

try:
    import torchaudio
    torchaudio.set_audio_backend("soundfile")
except Exception:
    pass

text_to_speech_model = None
current_loaded_device = None

class SynthesizeRequest(BaseModel):
    text: str
    language: str
    reference_audio_base64: str
    reference_text: str
    device: str = "auto" # ✅ Receives 'auto', 'cpu', or 'gpu' from Node.js

def load_model(target_device: str):
    global text_to_speech_model, current_loaded_device
    
    # Map frontend device preference to PyTorch device
    if target_device in ["gpu", "auto"]:
        device_map = "cuda:0" if torch.cuda.is_available() else "cpu"
    else:
        device_map = "cpu"
        
    # Skip reloading if the model is already on the correct device
    if current_loaded_device == device_map and text_to_speech_model is not None:
        return

    # bfloat16 is stable on both CPU and GPU, and halves memory bandwidth usage
    data_type = torch.bfloat16 
    
    print(f"[Text To Speech] Loading Qwen3 model on {device_map} with {data_type}...", flush=True)
    
    from qwen_tts import Qwen3TTSModel
    text_to_speech_model = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        device_map=device_map,
        dtype=data_type,
        low_cpu_mem_usage=True
    )
    current_loaded_device = device_map
    print(f"[Text To Speech] Model loaded and ready on {device_map}.", flush=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-load on auto/cuda by default on startup to save the first request latency
    load_model("auto")
    yield
    global text_to_speech_model
    text_to_speech_model = None

app = FastAPI(lifespan=lifespan)

@app.post("/generate")
async def generate(request: SynthesizeRequest):
    try:
        load_model(request.device)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load model on {request.device}: {str(e)}")

    if text_to_speech_model is None:
        raise HTTPException(status_code=503, detail="Model failed to load")

    language_map = {
        "ja": "Japanese", "en": "English", "zh": "Chinese", "ko": "Korean",
        "es": "Spanish", "fr": "French", "de": "German", "ru": "Russian",
        "pt": "Portuguese", "it": "Italian"
    }
    language = language_map.get(request.language, "English")

    try:
        audio_bytes = base64.b64decode(request.reference_audio_base64)
        audio_array, _ = librosa.load(io.BytesIO(audio_bytes), sr=24000, mono=True)
        
        temp_ref_path = "temp_ref_audio.wav"
        soundfile.write(temp_ref_path, audio_array, 24000)

        print(f"[Text To Speech] Starting generation for: {request.text[:30]}...", flush=True)
        
        device_type = "cuda" if current_loaded_device == "cuda:0" else "cpu"
        with torch.inference_mode(), torch.autocast(device_type=device_type, dtype=torch.bfloat16):
            waveforms, sample_rate = text_to_speech_model.generate_voice_clone(
                text=request.text,
                language=language,
                ref_audio=temp_ref_path,
                ref_text=request.reference_text,
            )
        
        os.remove(temp_ref_path)
        
        print("[Text To Speech] Generation complete. Encoding WAV.", flush=True)

        buffer = io.BytesIO()
        soundfile.write(buffer, waveforms[0].float().cpu().numpy(), sample_rate, format='WAV')
        buffer.seek(0)
        
        return {"audio_base64": base64.b64encode(buffer.read()).decode('utf-8')}
    except Exception as error:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(error))

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8449
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")