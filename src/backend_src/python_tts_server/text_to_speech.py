import os
import sys
import base64
import io
import uuid
import warnings
import torch
import soundfile
import torchaudio
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from contextlib import asynccontextmanager

# ✅ Globally suppress annoying third-party deprecation warnings
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["DISABLE_TELEMETRY"] = "YES"
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"

# ✅ Isolate temporary files in a dedicated 'temp' folder at the project root
# This prevents flooding the source code directory with transient artifacts
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(SCRIPT_DIR))
TEMP_DIR = os.path.join(PROJECT_ROOT, 'temp')

os.makedirs(TEMP_DIR, exist_ok=True)

text_to_speech_model = None
current_loaded_device = None
_environment_logged = False

class SynthesizeRequest(BaseModel):
    text: str
    language: str
    reference_audio_base64: str
    reference_text: str
    device: str = "auto"

def load_model(target_device: str):
    global text_to_speech_model, current_loaded_device, _environment_logged
    
    if target_device in ["gpu", "auto"]:
        if torch.cuda.is_available():
            device_map = "cuda:0"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device_map = "mps"
        else:
            device_map = "cpu"
    else:
        device_map = "cpu"
        
    # ✅ Skip entirely if already loaded on the correct device (no spam)
    if current_loaded_device == device_map and text_to_speech_model is not None:
        return

    # ✅ Only log environment diagnostics ONCE on the very first load
    if not _environment_logged:
        print(f"[Text To Speech] PyTorch version: {torch.__version__}", flush=True)
        print(f"[Text To Speech] CUDA available: {torch.cuda.is_available()}", flush=True)
        if hasattr(torch, 'version') and hasattr(torch.version, 'cuda'):
            print(f"[Text To Speech] PyTorch CUDA version: {torch.version.cuda}", flush=True)
        else:
            print(f"[Text To Speech] PyTorch CUDA version: None", flush=True)
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            print(f"[Text To Speech] Apple MPS available", flush=True)
        _environment_logged = True

    data_type = torch.bfloat16 if device_map != "cpu" else torch.float32
    print(f"[Text To Speech] Loading Qwen3 model on {device_map} with {data_type}...", flush=True)
    
    from qwen_tts import Qwen3TTSModel
    text_to_speech_model = Qwen3TTSModel.from_pretrained(
        "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        device_map=device_map,
        torch_dtype=data_type,  # Kept for compatibility, warning suppressed globally
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

    temp_ref_path = None
    try:
        audio_bytes = base64.b64decode(request.reference_audio_base64)
        
        waveform, sample_rate = torchaudio.load(io.BytesIO(audio_bytes))
        
        if sample_rate != 24000:
            retokenSampler = torchaudio.transforms.Resample(orig_freq=sample_rate, new_freq=24000)
            waveform = retokenSampler(waveform)
            
        if waveform.shape[0] > 1:
            waveform = torch.mean(waveform, dim=0, keepdim=True)
            
        # ✅ Use the dedicated temp directory at project root
        request_id = str(uuid.uuid4())
        temp_ref_path = os.path.join(TEMP_DIR, f"temp_ref_audio_{request_id}.wav")
        
        waveform_np = waveform.cpu().numpy()
        waveform_np = waveform_np[0] 
        
        soundfile.write(temp_ref_path, waveform_np, 24000)

        device_type = current_loaded_device.split(':')[0] if ':' in current_loaded_device else current_loaded_device
        with torch.inference_mode(), torch.autocast(device_type=device_type, dtype=torch.bfloat16, enabled=(device_type != "cpu")):
            waveforms, out_sr = text_to_speech_model.generate_voice_clone(
                text=request.text,
                language=language,
                ref_audio=temp_ref_path,
                ref_text=request.reference_text,
            )

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
    finally:
        # ✅ CLEANUP: Always delete the unique temp file safely
        if temp_ref_path and os.path.exists(temp_ref_path):
            try:
                os.remove(temp_ref_path)
            except Exception:
                pass

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8449
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")