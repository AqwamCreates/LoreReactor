import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001;

const ROOT_DIR = process.cwd(); 

app.use(cors());
app.use(express.json());

// ✅ THE FIX: Use app.use() as middleware instead of app.put() routing.
// This catches ANY request starting with /user_data, regardless of what comes after.
app.use('/user_data', (req, res) => {
  // Reconstruct the full path relative to root
  // req.url here will be whatever comes AFTER '/user_data' (e.g., /chat_messages/file.json)
  const relativePath = req.url!.startsWith('/') ? req.url!.slice(1) : req.url;
  const filePath = path.join(ROOT_DIR, 'user_data', relativePath);
  const dir = path.dirname(filePath);

  console.log(`📥 Request: ${req.method} ${req.url}`);
  console.log(`💾 Target: ${filePath}`);

  if (req.method === 'PUT') {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created dir: ${dir}`);
      } catch (err: any) {
        return res.status(500).json({ error: 'Failed to create directory', details: err.message });
      }
    }

    fs.writeFile(filePath, JSON.stringify(req.body, null, 2), (err: any) => {
      if (err) {
        console.error(`❌ Write failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to write file', details: err.message });
      }
      console.log(`✅ Saved: ${filePath}`);
      res.status(200).json({ success: true, path: filePath });
    });
  } 
  else if (req.method === 'DELETE') {
    fs.unlink(filePath, (err: any) => {
      if (err && err.code !== 'ENOENT') {
        console.error(`❌ Delete failed: ${err.message}`);
        return res.status(500).json({ error: 'Failed to delete file', details: err.message });
      }
      if (err && err.code === 'ENOENT') {
        console.warn(`⚠️ File not found: ${filePath}`);
        return res.status(200).json({ success: true, message: 'File not found' });
      }
      console.log(`✅ Deleted: ${filePath}`);
      res.status(200).json({ success: true });
    });
  } 
  else {
    // Handle GET or other methods if needed, or reject
    res.status(405).json({ error: 'Method not allowed on this middleware' });
  }
});

app.listen(PORT, () => {
  console.log("-----------------------------------------");
  console.log(`✅ Storage API Running on http://localhost:${PORT}`);
  console.log(`📂 Root Directory: ${ROOT_DIR}`);
  console.log(`📝 Handling all /user_data/* requests`);
  console.log("-----------------------------------------");
});