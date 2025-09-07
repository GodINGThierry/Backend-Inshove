const express = require('express');
const multer = require('multer');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - Dynamic CORS configuration
const corsOrigins = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Check if origin matches any allowed pattern
    const isAllowed = corsOrigins.some(allowedOrigin => {
      if (allowedOrigin.includes('*')) {
        // Convert wildcard pattern to regex
        const pattern = allowedOrigin.replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`);
        return regex.test(origin);
      }
      return allowedOrigin === origin;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`CORS: Origin ${origin} not allowed`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Configuration de Multer pour l'upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5GB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Seules les vidéos sont autorisées'));
    }
  }
});

// Fonction de traitement FFmpeg optimisée
async function processVideoWithFFmpeg(inputPath, outputPath, segmentsToKeep) {
  return new Promise((resolve, reject) => {
    console.log('🎬 Début traitement FFmpeg:', { inputPath, outputPath, segmentsToKeep });
    
    if (!segmentsToKeep || segmentsToKeep.length === 0) {
      return reject(new Error('Aucun segment à conserver spécifié'));
    }

    // Construire les filtres select pour les segments à garder
    const videoSelectFilters = segmentsToKeep.map((segment, index) => {
      const start = segment.start;
      const end = segment.end;
      return `between(t,${start},${end})`;
    }).join('+');

    const audioSelectFilters = segmentsToKeep.map((segment, index) => {
      const start = segment.start;
      const end = segment.end;
      return `between(t,${start},${end})`;
    }).join('+');

    const command = ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .addOption('-preset', 'ultrafast')
      .addOption('-crf', '23')
      .complexFilter([
        `[0:v]select='${videoSelectFilters}',setpts=N/FRAME_RATE/TB[v]`,
        `[0:a]aselect='${audioSelectFilters}',asetpts=N/SR/TB[a]`
      ])
      .outputOptions(['-map', '[v]', '-map', '[a]'])
      .output(outputPath)
      .on('start', (commandLine) => {
        console.log('🚀 Commande FFmpeg:', commandLine);
      })
      .on('progress', (progress) => {
        console.log('📊 Progression:', Math.round(progress.percent || 0) + '%');
      })
      .on('end', () => {
        console.log('✅ Traitement terminé avec succès');
        resolve();
      })
      .on('error', (err) => {
        console.error('❌ Erreur FFmpeg:', err.message);
        reject(err);
      });

    command.run();
  });
}

// Fonction de nettoyage des fichiers
function cleanupFiles(filePaths) {
  filePaths.forEach(filePath => {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log('🗑️ Fichier supprimé:', filePath);
      } catch (error) {
        console.error('❌ Erreur suppression fichier:', filePath, error.message);
      }
    }
  });
}

// Endpoint de traitement vidéo
app.post('/api/process-video', upload.single('video'), async (req, res) => {
  let inputPath = null;
  let outputPath = null;

  try {
    console.log('📥 Nouvelle demande de traitement vidéo');
    
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier vidéo fourni' });
    }

    console.log('📁 Fichier reçu:', req.file.originalname, 'Taille:', req.file.size);

    const segmentsData = JSON.parse(req.body.segments || '[]');
    console.log('🎯 Segments à traiter:', segmentsData);

    if (!segmentsData || segmentsData.length === 0) {
      return res.status(400).json({ error: 'Aucun segment spécifié' });
    }

    inputPath = req.file.path;
    const outputFilename = `processed-${Date.now()}.mp4`;
    outputPath = path.join('processed', outputFilename);

    // Créer le dossier processed s'il n'existe pas
    if (!fs.existsSync('processed')) {
      fs.mkdirSync('processed', { recursive: true });
    }

    // Traitement avec FFmpeg
    await processVideoWithFFmpeg(inputPath, outputPath, segmentsData);

    // Vérifier que le fichier de sortie existe
    if (!fs.existsSync(outputPath)) {
      throw new Error('Le fichier traité n\'a pas été créé');
    }

    console.log('📤 Envoi du fichier traité:', outputFilename);

    // Envoyer le fichier traité
    res.download(outputPath, outputFilename, (err) => {
      if (err) {
        console.error('❌ Erreur download:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Erreur lors du téléchargement' });
        }
      }
      
      // Nettoyer les fichiers temporaires après 5 minutes
      setTimeout(() => {
        cleanupFiles([inputPath, outputPath]);
      }, 300000);
    });

  } catch (error) {
    console.error('❌ Erreur traitement:', error);
    
    // Nettoyer les fichiers en cas d'erreur
    if (inputPath || outputPath) {
      cleanupFiles([inputPath, outputPath].filter(Boolean));
    }
    
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Endpoint de santé
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

// Endpoint de test
app.get('/api/test', (req, res) => {
  res.json({ message: 'Serveur vidéo opérationnel !' });
});

// Gestion des erreurs globales
app.use((error, req, res, next) => {
  console.error('❌ Erreur serveur:', error);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// Démarrer le serveur
app.listen(PORT, () => {
  console.log(`🚀 Serveur vidéo démarré sur le port ${PORT}`);
  console.log(`📁 Dossiers: uploads/, processed/`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
  
  // Créer les dossiers nécessaires
  ['uploads', 'processed', 'tmp'].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Dossier créé: ${dir}/`);
    }
  });
});

module.exports = app;