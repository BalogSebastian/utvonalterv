/** OSM csempe-proxy: azonos origin (nincs CORS/adblock gond), azonosítható User-Agent, hosszú cache. */
export async function GET(_req: Request, ctx: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z, x, y } = await ctx.params;
  const yy = y.replace(/\.png$/, "");
  if (![z, x, yy].every((v) => /^\d{1,2}$|^\d{1,6}$/.test(v)) || +z > 19) {
    return new Response("bad tile", { status: 400 });
  }
  try {
    const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${yy}.png`, {
      headers: { "User-Agent": "tesotter-truck-planner/1.0 (route planner)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return new Response("upstream error", { status: 502 });
    return new Response(res.body, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
      },
    });
  } catch {
    return new Response("tile fetch failed", { status: 504 });
  }
}
