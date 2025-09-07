# Serveur de Traitement Vidéo

Serveur Node.js/Express pour le traitement de vidéos avec FFmpeg.

## Installation

1. **Installer FFmpeg** (requis)
   ```bash
   # Ubuntu/Debian
   sudo apt update && sudo apt install ffmpeg
   
   # macOS avec Homebrew
   brew install ffmpeg
   
   # Windows: télécharger depuis https://ffmpeg.org/download.html
   ```

2. **Installer les dépendances**
   ```bash
   npm install
   ```

3. **Configurer l'environnement**
   ```bash
   cp .env.example .env
   # Éditer .env selon vos besoins
   ```

## Démarrage

```bash
# Développement avec rechargement automatique
npm run dev

# Production
npm start
```

Le serveur démarre sur http://localhost:3001

## Endpoints

### POST /api/process-video
Traite une vidéo en supprimant/gardant les segments spécifiés.

**Body:**
- `video`: Fichier vidéo (multipart/form-data)
- `segments`: JSON des segments à conserver

**Exemple:**
```javascript
const formData = new FormData();
formData.append('video', videoFile);
formData.append('segments', JSON.stringify([
  { start: 0, end: 10, type: 'keep' },
  { start: 20, end: 30, type: 'keep' }
]));
```

### GET /health
Vérification de l'état du serveur.

### GET /api/test
Test de connectivité.

## Structure des dossiers

```
backend/
├── server.js          # Serveur principal
├── package.json
├── .env               # Variables d'environnement
├── uploads/           # Fichiers uploadés (temporaire)
├── processed/         # Vidéos traitées (temporaire)
└── tmp/              # Fichiers temporaires
```

## Configuration

Variables d'environnement disponibles dans `.env`:

- `PORT`: Port du serveur (défaut: 3001)
- `NODE_ENV`: Environnement (development/production)
- `CORS_ORIGIN`: Origine autorisée pour CORS
- `MAX_FILE_SIZE`: Taille max des fichiers (défaut: 5GB)
- `CLEANUP_DELAY`: Délai de nettoyage des fichiers (défaut: 5min)

## Sécurité

- Validation des types de fichiers (vidéos uniquement)
- Limitation de la taille des fichiers
- Nettoyage automatique des fichiers temporaires
- CORS configuré pour le frontend

## Performance

- Utilise `ultrafast` preset pour FFmpeg
- Traitement optimisé avec filter_complex
- Nettoyage automatique des ressources
- Support des gros fichiers (jusqu'à 5GB)

## Dépannage

1. **FFmpeg non trouvé**
   - Vérifier l'installation: `ffmpeg -version`
   - Ajouter FFmpeg au PATH système

2. **Erreurs de CORS**
   - Vérifier CORS_ORIGIN dans .env
   - S'assurer que le frontend utilise la bonne URL

3. **Mémoire insuffisante**
   - Augmenter la limite Node.js: `node --max-old-space-size=4096 server.js`
   - Surveiller l'utilisation mémoire via /health