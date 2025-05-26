## Redirect all HTTP requests to HTTPS
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name tonemagic.store www.tonemagic.store;

    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host            $host;
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Redirect everything else to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

## Serve on HTTPS with Let's Encrypt certificates
server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name tonemagic.store www.tonemagic.store;

    ssl_certificate     /etc/letsencrypt/live/tonemagic.store/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tonemagic.store/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    root /var/www/missing-tones-app/frontend/build;
    index index.html;

    # Static assets
    location /static/ {
        try_files $uri $uri/ =404;
    }

    # SPA fallback to index.html
    location / {
        try_files $uri /index.html;
    }

    # Proxy API
    location /api/ {
        proxy_pass http://127.0.0.1:8000/;
        proxy_set_header Host            $host;
        proxy_set_header X-Real-IP       $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}