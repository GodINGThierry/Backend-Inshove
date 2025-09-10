FROM node:18-alpine

# Installation de FFmpeg
RUN apk add --no-cache ffmpeg

# Répertoire de travail
WORKDIR /app

# Copie des fichiers de dépendances
COPY package*.json ./

# Installation des dépendances
RUN npm install --omit=dev --no-audit --no-fund

# Copie du code source
COPY . .

# Création des dossiers nécessaires
RUN mkdir -p uploads processed tmp

# Exposition du port
EXPOSE 3001

# Variables d'environnement
ENV NODE_ENV=production
ENV PORT=3001

# Commande de démarrage
CMD ["node", "server.js"]
