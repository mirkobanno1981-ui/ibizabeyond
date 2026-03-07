# 🚀 Guida: VPS Hostinger + Dominio + WordPress WPRentals

> Sia VPS che dominio sono su Hostinger — setup completo passo-passo.

---

## Fase 1 — Collegare il Dominio alla VPS

### 1.1 Trova l'IP della tua VPS
1. Accedi a **hpanel.hostinger.com**
2. Menu laterale → **VPS** → clicca sulla tua VPS
3. Nella dashboard VPS, copia l'**indirizzo IP** (es. `185.xxx.xxx.xxx`)

### 1.2 Punta il dominio all'IP della VPS
1. Torna alla home di hPanel
2. Menu laterale → **Domini** → clicca sul tuo dominio
3. Vai a **DNS / Nameservers** → **DNS Records**
4. Modifica (o crea) questi record:

| Tipo | Nome | Valore | TTL |
|------|------|--------|-----|
| **A** | `@` | `185.xxx.xxx.xxx` (IP VPS) | 3600 |
| **CNAME** | `www` | `tuodominio.com` | 3600 |

5. **Salva** e attendi la propagazione (15 min - 2 ore su Hostinger, dato che è tutto interno)

### 1.3 Verifica la propagazione
- Visita: https://dnschecker.org
- Cerca il tuo dominio → verifica che il record A punti all'IP della VPS

---

## Fase 2 — Configurare la VPS per WordPress

### 2.1 Accedi alla VPS via SSH
```bash
ssh root@185.xxx.xxx.xxx
# inserisci la password impostata durante la creazione della VPS
```
*(oppure usa il terminale integrato di hPanel: VPS → pannello → **Browser Terminal**)*

### 2.2 Installa il web server (se non presente)

**Opzione A — Usa il template Hostinger (più facile):**
1. In hPanel → VPS → **Sistema Operativo**
2. Scegli il template **"Ubuntu + WordPress"** o **"Ubuntu + CyberPanel"**
3. Hostinger installerà tutto automaticamente (Apache/Nginx + PHP + MySQL + WordPress)

**Opzione B — Installazione manuale con LAMP:**
```bash
# Aggiorna il sistema
sudo apt update && sudo apt upgrade -y

# Installa Apache
sudo apt install apache2 -y
sudo systemctl enable apache2

# Installa MySQL
sudo apt install mysql-server -y
sudo mysql_secure_installation

# Installa PHP 8.2+
sudo apt install php8.2 php8.2-mysql php8.2-curl php8.2-gd \
  php8.2-mbstring php8.2-xml php8.2-zip php8.2-intl \
  php8.2-imagick libapache2-mod-php8.2 -y

# Riavvia Apache
sudo systemctl restart apache2
```

### 2.3 Crea il database MySQL
```bash
sudo mysql -u root -p
```
```sql
CREATE DATABASE wordpress_db;
CREATE USER 'wp_user'@'localhost' IDENTIFIED BY 'UnaPasswordForte123!';
GRANT ALL PRIVILEGES ON wordpress_db.* TO 'wp_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

---

## Fase 3 — Installare WordPress

### 3.1 Scarica e installa WordPress
```bash
cd /var/www/html
sudo rm -f index.html

# Scarica WordPress
sudo wget https://wordpress.org/latest.tar.gz
sudo tar -xzf latest.tar.gz
sudo mv wordpress/* .
sudo rm -rf wordpress latest.tar.gz

# Imposta i permessi
sudo chown -R www-data:www-data /var/www/html
sudo chmod -R 755 /var/www/html
```

### 3.2 Configura Apache per il dominio
```bash
sudo nano /etc/apache2/sites-available/tuodominio.conf
```
Inserisci:
```apache
<VirtualHost *:80>
    ServerName tuodominio.com
    ServerAlias www.tuodominio.com
    DocumentRoot /var/www/html
    
    <Directory /var/www/html>
        AllowOverride All
        Require all granted
    </Directory>
    
    ErrorLog ${APACHE_LOG_DIR}/error.log
    CustomLog ${APACHE_LOG_DIR}/access.log combined
</VirtualHost>
```
```bash
sudo a2ensite tuodominio.conf
sudo a2enmod rewrite
sudo systemctl restart apache2
```

### 3.3 Completa l'installazione via browser
1. Visita `http://tuodominio.com`
2. Seleziona **Italiano**
3. Inserisci i dati del database:
   - Nome database: `wordpress_db`
   - Utente: `wp_user`
   - Password: `UnaPasswordForte123!`
   - Host: `localhost`
   - Prefisso tabelle: `wp_`
4. Crea l'account admin del sito
5. Clicca **Installa WordPress**

---

## Fase 4 — SSL (HTTPS) con Let's Encrypt

```bash
# Installa Certbot
sudo apt install certbot python3-certbot-apache -y

# Genera il certificato SSL
sudo certbot --apache -d tuodominio.com -d www.tuodominio.com

# Rinnovo automatico (già configurato, verifica con):
sudo certbot renew --dry-run
```

Dopo il certificato, in WordPress:
- **Impostazioni → Generali** → cambia entrambi gli URL in `https://tuodominio.com`

---

## Fase 5 — Installare WPRentals

### 5.1 Carica il tema
1. Accedi a `https://tuodominio.com/wp-admin`
2. **Aspetto → Temi → Aggiungi nuovo → Carica tema**
3. Seleziona il file `.zip` di WPRentals (scaricato da ThemeForest)
4. Clicca **Installa ora** → **Attiva**

### 5.2 Installa i plugin obbligatori
- WPRentals mostrerà un banner giallo in alto
- Clicca **"Begin installing plugins"**
- Seleziona tutti → Installa → Attiva

### 5.3 Inserisci la licenza
1. **WPRentals → Dashboard**
2. Inserisci il **Purchase Code** di ThemeForest
3. Clicca **Verifica**

### 5.4 Importa una demo
1. **WPRentals → Demo Import**
2. Consigliata: **Ibiza Demo** 🏝️
3. Clicca **Import** → attendi 2-5 minuti

---

## Fase 6 — Configurazioni Post-Installazione

| # | Cosa | Dove |
|---|------|------|
| 1 | **Homepage** | Impostazioni → Lettura → Pagina statica → scegli "Home" |
| 2 | **Permalink** | Impostazioni → Permalink → "Nome articolo" |
| 3 | **Google Maps API** | WPRentals → Theme Options → Google Maps |
| 4 | **Valuta €** | WPRentals → Theme Options → Booking → Currency: EUR |
| 5 | **Logo** | WPRentals → Theme Options → Header → Logo |
| 6 | **PHP Memory** | Modifica `wp-config.php`, aggiungi: `define('WP_MEMORY_LIMIT', '256M');` |

---

## Fase 7 — Ottimizzazioni VPS consigliate

```bash
# Aumenta il limite upload PHP
sudo nano /etc/php/8.2/apache2/php.ini
```
Modifica:
```ini
upload_max_filesize = 128M
post_max_size = 128M
max_execution_time = 300
memory_limit = 512M
```
```bash
sudo systemctl restart apache2
```

---

## ✅ Checklist Finale

- [ ] IP VPS copiato
- [ ] Record A e CNAME configurati nel DNS del dominio
- [ ] Propagazione DNS verificata
- [ ] Web server (Apache/Nginx) installato sulla VPS
- [ ] PHP 8.2+ e MySQL installati
- [ ] Database WordPress creato
- [ ] WordPress scaricato e installato
- [ ] Installazione guidata completata via browser
- [ ] SSL/HTTPS attivato con Let's Encrypt
- [ ] Tema WPRentals caricato e attivato
- [ ] Plugin obbligatori installati
- [ ] Licenza ThemeForest verificata
- [ ] Demo Ibiza importata
- [ ] Homepage, permalink e Google Maps configurati
- [ ] Limiti PHP ottimizzati

---

> 💡 **Tip:** Se la tua VPS Hostinger ha **CyberPanel** o **HestiaCP** preinstallato, puoi saltare tutta la Fase 2-3 e installare WordPress direttamente dal pannello di controllo con un click!

*Guida creata il 4 marzo 2026 per Ibiza Beyond*
