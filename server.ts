import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3001; // Use a different port for writes

app.use(express.json());

// Handle PUT requests to save files
app.put('/user_data/*', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.path);
  const dir = path.dirname(filePath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFile(filePath, JSON.stringify(req.body, null, 2), (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send('Error saving file');
    }
    res.send('Saved');
  });
});

// Handle DELETE requests
app.delete('/user_data/*', (req, res) => {
  const filePath = path.join(__dirname, 'public', req.path);
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      return res.status(500).send('Error deleting file');
    }
    res.send('Deleted');
  });
});

app.listen(PORT, () => {
  console.log(`Storage API running on http://localhost:${PORT}`);
});