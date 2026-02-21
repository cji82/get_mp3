const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 38472;
const tempDir = path.join(os.tmpdir(), 'get_mp3');
const fileStore = new Map(); // id -> { filePath, createdAt }

app.use(cors({ origin: true }));
app.use(express.json());

const YOUTUBE_REGEX = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+$/;

const serverDir = path.resolve(__dirname);
const YT_DLP_CMD = process.env.YT_DLP_PATH
  || path.join(serverDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const FFMPEG_PATH = process.env.FFMPEG_PATH
  || path.join(serverDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const NODE_PATH = process.env.JS_RUNTIME_PATH || process.execPath;
const spawnEnv = { ...process.env, PATH: serverDir + path.delimiter + (process.env.PATH || '') };

function ensureTempDir() {
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
}

function runYtDlp(youtubeUrl, audioQuality = 0) {
  const q = Math.min(9, Math.max(0, parseInt(audioQuality, 10) || 0));
  return new Promise((resolve, reject) => {
    ensureTempDir();
    const id = `mp3_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const outPath = path.join(tempDir, `${id}.mp3`);
    const args = [
      '--js-runtimes', `node:${NODE_PATH}`,
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', String(q),
      '--ffmpeg-location', FFMPEG_PATH,
      '-o', outPath,
      '--no-playlist',
      youtubeUrl
    ];
    const proc = spawn(YT_DLP_CMD, args, { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outPath)) {
        resolve(outPath);
      } else {
        if (fs.existsSync(outPath)) try { fs.unlinkSync(outPath); } catch (_) {}
        reject(new Error(stderr || `yt-dlp exited ${code}`));
      }
    });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp를 찾을 수 없습니다. 설치 후 PATH에 추가하거나 YT_DLP_PATH 환경변수로 경로를 지정하세요.'));
      } else {
        reject(err);
      }
    });
  });
}

app.get('/convert', async (req, res) => {
  const url = (req.query.url || '').trim();
  const quality = req.query.quality;
  if (!url || !YOUTUBE_REGEX.test(url)) {
    return res.status(400).json({ error: '유효한 YouTube URL을 입력하세요.' });
  }
  try {
    const filePath = await runYtDlp(url, quality);
    const stat = fs.statSync(filePath);
    const downloadId = path.basename(filePath, '.mp3');
    fileStore.set(downloadId, { filePath, createdAt: Date.now() });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ downloadUrl: `${baseUrl}/file/${downloadId}.mp3` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '변환 실패' });
  }
});

app.get('/file/:id', (req, res) => {
  const id = (req.params.id || '').replace(/\.mp3$/i, '');
  const entry = fileStore.get(id);
  if (!entry || !fs.existsSync(entry.filePath)) {
    return res.status(404).send('파일 없음');
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', 'attachment; filename="' + id + '.mp3"');
  const stream = fs.createReadStream(entry.filePath);
  stream.pipe(res);
  stream.on('end', () => {
    try {
      fs.unlinkSync(entry.filePath);
      fileStore.delete(id);
    } catch (_) {}
  });
  stream.on('error', () => {
    try { fs.unlinkSync(entry.filePath); } catch (_) {}
    fileStore.delete(id);
  });
});

// 오래된 임시 파일 정리 (10분)
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000;
  for (const [id, entry] of fileStore.entries()) {
    if (now - entry.createdAt > maxAge) {
      try { if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath); } catch (_) {}
      fileStore.delete(id);
    }
  }
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`서버 http://localhost:${PORT}`);
});
