import os
import sys
import base64
import io
import uuid
import torch
import soundfile
import torchaudio
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["DISABLE_TELEMETRY"] = "YES"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

try:
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
    device: str = "auto"

def load_model(target_device: str):
    global text_to_speech_model, current_loaded_device
    
    print(f"[Text To Speech] PyTorch version: {torch.__version__}", flush=True)
    print(f"[Text To Speech] CUDA available: {torch.cuda.is_available()}", flush=True)
    
    if hasattr(torch, 'version') and hasattr(torch.version, 'cuda'):
        print(f"[Text To Speech] PyTorch CUDA version: {torch.version.cuda}", flush=True)
    else:
        print(f"[Text To Speech] PyTorch CUDA version: None", flush=True)
        
    if torch.backends.mps.is_available():
        print(f"[Text To Speech] Apple MPS available", flush=True)

    if target_device in ["gpu", "auto"]:
        if torch.cuda.is_available():
            device_map = "cuda:0"
        elif torch.backends.mps.is_available():
            device_map = "mps"
        else:
            device_map = "cpu"
    else:
        device_map = "cpu"
        
    if current_loaded_device == device_map and text_to_speech_model is not None:
        print(f"[Text To Speech] Model already loaded on {device_map}, skipping reload", flush=True)
        return

    data_type = torch.bfloat16 if device_map != "cpu" else torch.float32
    
    print(f"[Text To Speech] Loading Qwen3 model on {device_map} with {data_type}...", flush=True)
    
    from qwen_tts import Qwen3TTSModel
    text_to_speech_model = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        device_map=device_map,
        torch_dtype=data_type,
        low_cpu_mem_usage=True
    )
    current_loaded_device = device_map
    print(f"[Text To Speech] Model loaded and ready on {device_map}.", flush=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
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
        
        waveform, sample_rate = torchaudio.load(io.BytesIO(audio_bytes))
        
        if sample_rate != 24000:
            resampler = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=24000)
            waveform = resampler(waveform)
            
        if waveform.shape[0] > 1:
            waveform = torch.mean(waveform, dim=0, keepdim=True)
        
        # ✅ FIX: Use unique filename for each concurrent request
        request_id = str(uuid.uuid4())
        temp_ref_path = f"temp_ref_audio_{request_id}.wav"
        torchaudio.save(temp_ref_path, waveform, 24000)

        print(f"[Text To Speech] Starting generation for: {request.text[:30]}...", flush=True)
        
        device_type = current_loaded_device.split(':')[0] if ':' in current_loaded_device else current_loaded_device
        with torch.inference_mode(), torch.autocast(device_type=device_type, dtype=torch.bfloat16, enabled=(device_type != "cpu")):
            waveforms, out_sr = text_to_speech_model.generate_voice_clone(
                text=request.text,
                language=language,
                ref_audio=temp_ref_path,
                ref_text=request.reference_text,
            )
        
        # Clean up the unique temp file
        os.remove(temp_ref_path)
        
        print("[Text To Speech] Generation complete. Encoding WAV.", flush=True)

        audio_data = waveforms[0]
        if hasattr(audio_data, "cpu"):
            audio_data = audio_data.float().cpu().numpy()

        buffer = io.BytesIO()
        soundfile.write(buffer, audio_data, out_sr, format='WAV')
        buffer.seek(0)
        
        return {"audio_base64": base64.b64encode(buffer.read()).decode('utf-8')}
    except Exception as error:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(error))

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8449
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")