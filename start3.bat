.\llama\llama-server.exe ^
    -m "user_data/models/Bonsai-27B-Q1_0.gguf" ^
    -c 65536 ^
    --cache-type-k q5_0 ^
    --cache-type-v q5_0 ^
    -np 1 ^
    --port 8080 ^
    --host 0.0.0.0 ^
    -ngl 99 ^
    --cache-reuse 1 ^
    -fa on ^
    --reasoning off

