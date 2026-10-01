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
  | { type: 'error'; message: string };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RequestMessage>) => void) | null;
  postMessage: (message: ResponseMessage, transfer?: Transferable[]) => void;
};

scope.onmessage = (event) => {
  const { blob, budget, preferExtended } = event.data;
  decodeGaussianPly(blob, {
    budget,
    preferExtended,
    onProgress: (progress) => {
      scope.postMessage({ type: 'progress', progress });
    },
  })
    .then((data) => {
      const transfer: Transferable[] = [];
      const push = (array: Uint32Array | undefined) => {
        if (array) transfer.push(array.buffer);
      };
      push(data.packedArray);
      if (data.extArrays) {
        push(data.extArrays[0]);
        push(data.extArrays[1]);
      }
      push(data.sh1);
      push(data.sh2);
      push(data.sh3);
      push(data.sh3b);
      scope.postMessage({ type: 'result', data }, transfer);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      scope.postMessage({ type: 'error', message });
    });
};
