import { describe, expect, it } from 'vitest';
import { UnimplementedStreamer } from '../src/streaming/types';

describe('streaming contract', () => {
  it('keeps unimplemented streamers from pretending to load', async () => {
    const streamer = new UnimplementedStreamer('potree-octree');
    await expect(streamer.open('scene/metadata.json', new AbortController().signal)).rejects.toThrow(/Phase 2/);
  });
});
