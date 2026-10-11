import os
import sys
import base64
import io
import torch
import soundfile
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["DISABLE_TELEMETRY"] = "YES"

app = FastAPI()
text_to_speech_model = None

class SynthesizeRequest(BaseModel):
    text: str
    language: str
    reference_audio_base64: str
    reference_text: str

@app.on_event("startup")
async def load_text_to_speech_model():
    global text_to_speech_model
    from qwen_tts import Qwen3TTSModel
    
    device_map = "cuda:0" if torch.cuda.is_available() else "cpu"
    data_type = torch.bfloat16 if device_map == "cuda:0" else torch.float32
    
    print(f"[Text To Speech] Loading Qwen3 model on {device_map}...", flush=True)
    text_to_speech_model = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        device_map=device_map,
        dtype=data_type,
    )
    print("[Text To Speech] Model loaded and ready.", flush=True)

@app.post("/generate")
async def generate(request: SynthesizeRequest):
    if text_to_speech_model is None:
        raise HTTPException(status_code=503, detail="Model is still loading")

    language_map = {
        "ja": "Japanese", "en": "English", "zh": "Chinese", "ko": "Korean",
        "es": "Spanish", "fr": "French", "de": "German", "ru": "Russian",
        "pt": "Portuguese", "it": "Italian"
    }
    language = language_map.get(request.language, "English")

    try:
        audio_bytes = base64.b64decode(request.reference_audio_base64)
        temp_ref_path = "temp_ref_audio.wav"
        with open(temp_ref_path, "wb") as f:
            f.write(audio_bytes)

        waveforms, sample_rate = text_to_speech_model.generate_voice_clone(
            text=request.text,
            language=language,
            ref_audio=temp_ref_path,
            ref_text=request.reference_text,
        )
        
        os.remove(temp_ref_path)

        buffer = io.BytesIO()
        soundfile.write(buffer, waveforms[0], sample_rate, format='WAV')
        buffer.seek(0)
        
        return {"audio_base64": base64.b64encode(buffer.read()).decode('utf-8')}
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error))

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8449
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")