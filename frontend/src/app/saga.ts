import { debug } from "../features/graph/global/utils";
import { graphSaga } from "../features/graph/graph-saga";

export function* saga() {
      while (true) {
          try {
              yield* graphSaga;
          } catch (e) {
              debug('Root saga catch!!!')
              debug(e as Error);
          }
      }
  }
