# Imported by /etc/caddy/Caddyfile. Uses the shared access_log snippet.
rc.lvyrix.com {
	import access_log

	@private path /.env /.env.* /.git /.git/*
	handle @private {
		respond 404
	}

	@api path /api /api/* /ws /share-ws /health
	handle @api {
		reverse_proxy 127.0.0.1:8798
	}

	@assets path /assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"
	@shell not path /api /api/* /ws /share-ws /health /assets/*
	header @shell Cache-Control "no-cache"
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		X-Frame-Options DENY
	}

	handle {
		encode zstd gzip
		root * /var/www/remote-console
		try_files {path} /index.html
		file_server
	}
}
