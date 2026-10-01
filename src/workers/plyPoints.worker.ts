import { blobSource } from '../core/byteSource';
import { parsePlyPoints, type PointCloudData } from '../loaders/points/parsePly';

interface RequestMessage {
  file: Blob;
  maxPoints: number;
}

type ResponseMessage =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'result'; data: PointCloudData }
  | { type: 'error'; message: string };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage: (message: ResponseMessage, transfer?: Transferable[]) => void;
};

scope.onmessage = (event) => {
  const { file, maxPoints } = event.data;
  void parsePlyPoints(blobSource(file), maxPoints, (loaded, total) => {
    scope.postMessage({ type: 'progress', loaded, total });
  })
    .then((data) => {
      const transfer: Transferable[] = [data.positions.buffer];
      if (data.colors) transfer.push(data.colors.buffer);
      scope.postMessage({ type: 'result', data }, transfer);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      scope.postMessage({ type: 'error', message });
    });
};
