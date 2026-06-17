# SeekCode GUI

Web-based chat interface for SeekCode agent.

## Setup

1. Install dependencies: `npm install`
2. Create `.env` file with `PORT=3000` and `GATEWAY_URL=http://localhost:8080`
3. Start gateway server first (from `deepseek-web-gateway` folder: `node src/server.js`)
4. Start GUI server: `npm start`
5. Open `http://localhost:3000`

## Architecture

Browser -> GUI Server (port 3000) -> Gateway Server (port 8080)

## Troubleshooting

- Ensure gateway is running before starting GUI.
- Check ports are free.
- Refresh page if session expires.

For full documentation, see project source.
