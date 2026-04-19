# Stage 1: Build
FROM node:20-alpine AS build

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2: Serve with Node (for SSR of OG tags on /quote/*)
FROM node:20-alpine

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY server.js ./

EXPOSE 8080

CMD ["node", "server.js"]
