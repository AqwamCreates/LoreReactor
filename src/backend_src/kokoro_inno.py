import sys
import os
import argparse
import torch
import torchaudio
import numpy as np
from huggingface_hub import hf_hub_download

# Add the inno-kokoro repo to path (assuming you cloned it into src/backend_src/inno-kokoro)
sys.path.append(os.path.join(os.path.dirname(__file__), 'inno-kokoro'))
from tune import TuneKokoro 

def main():
    parser = argparse.ArgumentParser(description="Kokoro Voice Cloning Script")
    parser.add_argument("audio_path", type=str, help="Path to input audio file")
    parser.add_argument("output_path", type=str, help="Path to output voicepack.bin")
    parser.add_argument("--device", type=str, default="auto", help="Device to use (cpu, cuda, mps, or auto)")
    args = parser.parse_args()

    # Resolve PyTorch device
    if args.device == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    else:
        device = args.device
        
    # Fallback if requested device is not actually available
    if device == "cuda" and not torch.cuda.is_available():
        device = "cpu"
    if device == "mps" and not (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()):
        device = "cpu"

    try:
        adapter_path = hf_hub_download(repo_id="remsky/kokoro-inno-clone-tuner", filename="model.safetensors")
        
        # Initialize tuner on the specific device
        try:
            tuner = TuneKokoro(adapter_path=adapter_path, device=device)
        except TypeError:
            # Fallback if the specific version of TuneKokoro doesn't accept device kwarg
            tuner = TuneKokoro(adapter_path=adapter_path)
        
        waveform, sample_rate = torchaudio.load(args.audio_path)
        if sample_rate != 16000:
            resampler = torchaudio.transforms.Resample(sample_rate, 16000)
            waveform = resampler(waveform)
            
        # Move waveform to device
        waveform = waveform.to(device)
        
        # Generate the [510, 256] voicepack tensor
        voicepack = tuner.generate_pack(waveform.squeeze().cpu().numpy() if isinstance(waveform, torch.Tensor) else waveform.squeeze())
        
        # Ensure it's moved to CPU before converting to numpy for saving
        if isinstance(voicepack, torch.Tensor):
            voicepack = voicepack.cpu().numpy()
            
        voicepack.astype(np.float32).tofile(args.output_path)
        print(f"SUCCESS (Device: {device})")
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()