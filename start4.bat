.\llama\llama-server.exe ^
    -m "user_data\models\gemma-4-12b-it-Q3_K_S.gguf" ^
    -c 65536 ^
    --cache-type-k q4_0 ^
    --cache-type-v q4_0 ^
    -np 1 ^
    --port 8080 ^
    --host 0.0.0.0 ^
    -ngl 99 ^
    --cache-reuse 1 ^
    -fa on ^
    --reasoning off

