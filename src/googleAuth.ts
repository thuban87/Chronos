import { requestUrl, RequestUrlResponse } from 'obsidian';
import * as http from 'http';

const SCOPES = [
    'https://www.googleapis.com/auth/calendar',  // Full calendar access (list calendars + manage events)
    'https://www.googleapis.com/auth/userinfo.email'
];
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

export interface TokenData {
    accessToken: string;
    refreshToken: string;
    expiresAt: number; // Unix timestamp in ms
    email?: string;
}

export interface AuthCallbacks {
    onTokensReceived: (tokens: TokenData) => Promise<void>;
    onError: (error: string) => void;
}

export interface GoogleAuthCredentials {
    clientId: string;
    clientSecret: string;
}

export class GoogleAuth {
    private server: http.Server | null = null;
    private currentPort: number = 0;
    private credentials: GoogleAuthCredentials;

    constructor(credentials: GoogleAuthCredentials) {
        this.credentials = credentials;
    }

    /**
     * Check if credentials are configured
     */
    hasCredentials(): boolean {
        return !!(this.credentials.clientId && this.credentials.clientSecret);
    }

    /**
     * Update credentials (e.g., when settings change)
     */
    updateCredentials(credentials: GoogleAuthCredentials): void {
        this.credentials = credentials;
    }

    /**
     * Start the OAuth flow by opening the browser to Google's consent screen
     */
    async startAuthFlow(callbacks: AuthCallbacks): Promise<void> {
        // Find an available port and start local server
        const port = await this.startCallbackServer(callbacks);
        this.currentPort = port;

        const redirectUri = `http://localhost:${port}/callback`;

        // Build the authorization URL
        const authUrl = new URL(AUTH_ENDPOINT);
        authUrl.searchParams.set('client_id', this.credentials.clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', SCOPES.join(' '));
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent'); // Force consent to get refresh token

        // Open browser to auth URL
        window.open(authUrl.toString());
    }

    /**
     * Start a local HTTP server to receive the OAuth callback
     */
    private startCallbackServer(callbacks: AuthCallbacks): Promise<number> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer(async (req, res) => {
                if (!req.url?.startsWith('/callback')) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }

                const url = new URL(req.url, `http://localhost:${this.currentPort}`);
                const code = url.searchParams.get('code');
                const error = url.searchParams.get('error');

                if (error) {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(this.getErrorHtml(error));
                    callbacks.onError(`Authorization denied: ${error}`);
                    this.stopServer();
                    return;
                }

                if (!code) {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(this.getErrorHtml('No authorization code received'));
                    callbacks.onError('No authorization code received');
                    this.stopServer();
                    return;
                }

                // Exchange code for tokens
                try {
                    const tokens = await this.exchangeCodeForTokens(code, `http://localhost:${this.currentPort}/callback`);
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(this.getSuccessHtml());
                    await callbacks.onTokensReceived(tokens);
                } catch (err) {
                    res.writeHead(500, { 'Content-Type': 'text/html' });
                    res.end(this.getErrorHtml(String(err)));
                    callbacks.onError(String(err));
                }

                this.stopServer();
            });

            // Try to find an available port (starting at 49152 - dynamic port range)
            const tryPort = (port: number) => {
                this.server!.once('error', (err: NodeJS.ErrnoException) => {
                    if (err.code === 'EADDRINUSE' && port < 65535) {
                        tryPort(port + 1);
                    } else {
                        reject(err);
                    }
                });

                this.server!.listen(port, '127.0.0.1', () => {
                    this.currentPort = port;
                    resolve(port);
                });
            };

            tryPort(49152);
        });
    }

    /**
     * Exchange authorization code for access and refresh tokens
     */
    private async exchangeCodeForTokens(code: string, redirectUri: string): Promise<TokenData> {
        const params = new URLSearchParams({
            client_id: this.credentials.clientId,
            client_secret: this.credentials.clientSecret,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
        });

        const response: RequestUrlResponse = await requestUrl({
            url: TOKEN_ENDPOINT,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
        });

        if (response.status !== 200) {
            throw new Error(`Token exchange failed: ${response.status}`);
        }

        const data = response.json;

        // Get user email for display
        let email: string | undefined;
        try {
            email = await this.getUserEmail(data.access_token);
        } catch {
            // Email fetch is optional, continue without it
        }

        return {
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresAt: Date.now() + (data.expires_in * 1000),
            email,
        };
    }

    /**
     * Refresh an expired access token using the refresh token
     */
    async refreshAccessToken(refreshToken: string): Promise<TokenData> {
        const params = new URLSearchParams({
            client_id: this.credentials.clientId,
            client_secret: this.credentials.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
        });

        const response: RequestUrlResponse = await requestUrl({
            url: TOKEN_ENDPOINT,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params.toString(),
        });

        if (response.status !== 200) {
            throw new Error(`Token refresh failed: ${response.status}`);
        }

        const data = response.json;

        // Get user email for display
        let email: string | undefined;
        try {
            email = await this.getUserEmail(data.access_token);
        } catch {
            // Email fetch is optional
        }

        return {
            accessToken: data.access_token,
            refreshToken: refreshToken, // Refresh token doesn't change
            expiresAt: Date.now() + (data.expires_in * 1000),
            email,
        };
    }

    /**
     * Get the user's email address for display purposes
     */
    private async getUserEmail(accessToken: string): Promise<string> {
        const response = await requestUrl({
            url: 'https://www.googleapis.com/oauth2/v2/userinfo',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (response.status !== 200) {
            throw new Error('Failed to fetch user info');
        }

        return response.json.email;
    }

    /**
     * Stop the callback server
     */
    stopServer(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }

    /**
     * Success HTML page shown after authorization
     */
    private getSuccessHtml(): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>Chronos - Connected!</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;
               background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .card { background: white; padding: 3rem; border-radius: 12px; text-align: center;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
        h1 { color: #22c55e; margin: 0 0 1rem; }
        p { color: #666; margin: 0; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Connected!</h1>
        <p>Chronos is now connected to Google Calendar.<br>You can close this window.</p>
    </div>
</body>
</html>`;
    }

    /**
     * Error HTML page shown if authorization fails
     */
    private getErrorHtml(error: string): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>Chronos - Error</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;
               background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .card { background: white; padding: 3rem; border-radius: 12px; text-align: center;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
        h1 { color: #ef4444; margin: 0 0 1rem; }
        p { color: #666; margin: 0; }
        code { background: #f3f4f6; padding: 0.25rem 0.5rem; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="card">
        <h1>Connection Failed</h1>
        <p>Error: <code>${error}</code></p>
        <p style="margin-top: 1rem;">Please try again from Obsidian settings.</p>
    </div>
</body>
</html>`;
    }
}
