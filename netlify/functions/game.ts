// Netlify Function — reachable at /.netlify/functions/game
import { handle } from "../../lib/game-server.ts";

export default async (req: Request): Promise<Response> => handle(req);
