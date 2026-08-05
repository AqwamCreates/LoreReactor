.\llama\llama-server.exe ^
    -m "user_data\models\Qwen3.5-4B-UD-Q6_K_XL.gguf" ^
    -c 65536 ^
    --cache-type-k iq4_nl ^
    --cache-type-v iq4_nl ^
    -np 1 ^
    --port 8080 ^
    --host 0.0.0.0 ^
    -ngl 99 ^
    --cache-reuse 256 ^
    -fa on ^
    --reasoning off

