import sys
import argparse
import torch
import numpy as np
from inno_kokoro.enroll import Tuner, enroll, read # pyright: ignore[reportMissingImports]

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
        # Initialize tuner (downloads weights to HF cache on first use)
        tuner = Tuner(device=device)
        
        # Read audio and generate the voice pack
        audio_data = read(args.audio_path)
        pack, _ = enroll(*audio_data, tuner)
        
        # Kokoro ONNX expects a flat [510, 256] float32 tensor.
        # The pack from inno-kokoro might be [510, 1, 256]. We squeeze the middle dimension.
        if pack.dim() == 3:
            pack = pack.squeeze(1)
            
        # Convert to numpy float32 and save as raw binary
        np.array(pack.cpu().detach(), dtype=np.float32).tofile(args.output_path)
        
        print(f"SUCCESS (Device: {device})")
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()