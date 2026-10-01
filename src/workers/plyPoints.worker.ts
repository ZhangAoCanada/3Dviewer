import { parsePlyPoints, type PointCloudData } from '../loaders/points/parsePly';

interface RequestMessage {
  file: Blob;
  maxPoints: number;
}

type ResponseMessage =
  | ({ ok: true } & PointCloudData)
  | { ok: false; error: string };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage: (message: ResponseMessage, transfer?: Transferable[]) => void;
};

scope.onmessage = (event) => {
  const { file, maxPoints } = event.data;
  parsePlyPoints(file, maxPoints)
    .then((data) => {
      const transfer: Transferable[] = [data.positions.buffer];
      if (data.colors) transfer.push(data.colors.buffer);
      scope.postMessage({ ok: true, ...data }, transfer);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      scope.postMessage({ ok: false, error: message });
    });
};
