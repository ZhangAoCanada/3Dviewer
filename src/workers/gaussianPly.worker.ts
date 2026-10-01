import { decodeGaussianPly, type DecodedGaussian, type DecodeProgress } from '../loaders/gaussian/decodeGaussianPly';
import type { MemoryBudget } from '../core/types';

interface RequestMessage {
  blob: Blob;
  budget: MemoryBudget;
  preferExtended: boolean;
}

type ResponseMessage =
  | { type: 'progress'; progress: DecodeProgress }
  | { type: 'result'; data: DecodedGaussian }
  | { type: 'error'; message: string; name?: string };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage: (message: ResponseMessage, transfer?: Transferable[]) => void;
};

export function handleDecodeRequest(
  data: RequestMessage,
  post: (message: ResponseMessage, transfer?: Transferable[]) => void,
): Promise<void> {
  const { blob, budget, preferExtended } = data;
  return decodeGaussianPly(blob, {
    budget,
    preferExtended,
    onProgress: (progress) => {
      post({ type: 'progress', progress });
    },
  })
    .then((decoded) => {
      const transfer: Transferable[] = [];
      const push = (array: Uint32Array | undefined) => {
        if (array) transfer.push(array.buffer);
      };
      push(decoded.packedArray);
      if (decoded.extArrays) {
        push(decoded.extArrays[0]);
        push(decoded.extArrays[1]);
      }
      push(decoded.sh1);
      push(decoded.sh2);
      push(decoded.sh3);
      push(decoded.sh3b);
      post({ type: 'result', data: decoded }, transfer);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const name = error instanceof Error ? error.name : undefined;
      post(name ? { type: 'error', message, name } : { type: 'error', message });
    });
}

scope.onmessage = (event) => {
  void handleDecodeRequest(event.data, (message, transfer) => {
    if (transfer && transfer.length > 0) scope.postMessage(message, transfer);
    else scope.postMessage(message);
  });
};
