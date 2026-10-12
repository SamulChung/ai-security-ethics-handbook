import handbook from "../src/index.html?raw";
export function GET() { return new Response(handbook, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } }); }
