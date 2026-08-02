import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';

const app = express();
const PORT = 3001;
const ROOT_DIR = process.cwd(); 

app.use(cors());
// Increase limit to handle large base64 image strings
app.use(express.json({ limit: '50mb' }));

app.use('/user_data', (req, res) => {
  const relativePath = req.url?.startsWith('/') ? req.url?.slice(1) : req.url;
  const filePath = path.join(ROOT_DIR, 'user_data', relativePath || '');
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

    // ✅ IMAGE HANDLING: Detect base64 image uploads
    const isImageUpload = relativePath?.startsWith('character_images/');
    const body = req.body as any;

    if (isImageUpload && body && typeof body.base64 === 'string') {
      try {
        const buffer = Buffer.from(body.base64, 'base64');
        fs.writeFile(filePath, buffer, (err: any) => {
          if (err) {
            console.error(`❌ Image write failed: ${err.message}`);
            return res.status(500).json({ error: 'Failed to write image', details: err.message });
          }
          console.log(`✅ Saved image: ${filePath} (${buffer.length} bytes)`);
          res.status(200).json({ success: true, path: filePath });
        });
        return;
      } catch (err: any) {
        return res.status(400).json({ error: 'Invalid base64 data', details: err.message });
      }
    }

    // Standard JSON handling for everything else
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
    res.status(405).json({ error: 'Method not allowed on this middleware' });
  }
});

app.listen(PORT, () => {
  console.log("-----------------------------------------");
  console.log(`✅ Storage API Running on http://localhost:${PORT}`);
  console.log(`📂 Root Directory: ${ROOT_DIR}`);
  console.log("📝 Handling all /user_data/* requests");
  console.log("🖼️  Base64 image uploads supported at /user_data/character_images/");
  console.log("-----------------------------------------");
});