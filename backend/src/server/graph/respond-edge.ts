import { Server } from "socket.io";
import { io, Socket } from "socket.io-client";
import { config } from "../../../config/config";
import { Err, FETCH_ERRORS, NodeErr } from "../../../../frontend/src/features/graph/global/fetch-contract";

const server = new Server({

});

/*server.on("connection", (socket) => {
  addressChannel.newServer(socket, async function*(cursor, includeNode) {
    
  });
});*/

server.listen(config.edge.edgePort);

export interface SocketData {
  uid: string,
}

let socket: Socket;
export function getSocketClient(url: string): Socket {
  if (!socket) {
    const socket = io(url);
    socket.connect();
  }
  return socket;
}


async function* handleTimeout<T, RETURN, NEXT>(gen: AsyncGenerator<T, RETURN | NodeErr, NEXT>) {
  while (true) {
    try {
      const next = await gen.next();
      if (next.done) {
        return next.done;
      }
      yield next.value;
    } catch (e) {
      return {
        c: FETCH_ERRORS.NETWORK_ERROR,
        db: (e as Error).message,
      } as NodeErr;
    }
  }
}

/*
export const wsFetcher: GraphFetcher = {
  fetchAddressRels: (cursor, includeNode) => handleTimeout(fetchAddressRels({cursor, includeNode})),
  fetchBlock: (id: Block['id']) => handleTimeout(fetchBlock({id})),
  fetchTransaction: (id: Transaction['id']) => handleTimeout(fetchTransaction({id})),
  requestServerPush: () => requestServerPush({}),
}
*/
