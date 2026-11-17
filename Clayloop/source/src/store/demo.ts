import { ExportFile, getSession, getTrace, getVideo, listSessions, SessionRecord, Trace, validateExport } from './db';

/** The bundled documented session (generated from synthetic footage through the real pipeline). */
export const DEMO_ID = 'demo-synthetic';

let cache: Promise<ExportFile> | null = null;
export function loadBundledDemo(): Promise<ExportFile> {
  if (!cache) {
    cache = fetch('demo/demo-session.json')
      .then((r) => { if (!r.ok) throw new Error('Bundled demo session missing'); return r.json(); })
      .then((j) => validateExport(j))
      .catch((e) => { cache = null; throw e; });
  }
  return cache;
}

export interface Loaded {
  session: SessionRecord;
  trace: Trace;
  videoUrl: string | null;
  /** true when this lives in the library (editable); false for the bundled read-only demo */
  stored: boolean;
}

export async function loadAnySession(id: string): Promise<Loaded | null> {
  if (id === DEMO_ID) {
    const f = await loadBundledDemo();
    return { session: f.session, trace: f.trace, videoUrl: f.session.videoUrl ?? null, stored: false };
  }
  const session = await getSession(id);
  if (!session) return null;
  const trace = (await getTrace(id)) ?? { id, samples: [], thumbs: [] };
  let videoUrl: string | null = null;
  if (session.hasVideo) {
    const blob = await getVideo(id);
    if (blob) videoUrl = URL.createObjectURL(blob);
    else if (session.videoUrl) videoUrl = session.videoUrl;
  }
  return { session, trace, videoUrl, stored: true };
}

/** Exhibition session: the library session marked "featured", otherwise the bundled synthetic demo. */
export async function loadExhibitionSession(): Promise<Loaded> {
  try {
    const featured = (await listSessions()).find((s) => s.featured);
    if (featured) {
      const l = await loadAnySession(featured.id);
      if (l && l.trace.samples.length) return l;
    }
  } catch { /* fall through to bundled demo */ }
  return (await loadAnySession(DEMO_ID))!;
}
