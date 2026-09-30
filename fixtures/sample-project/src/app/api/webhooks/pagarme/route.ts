export async function POST(request: Request) { const sig = request.headers.get('x-hub-signature'); return Response.json({ sig }) }
