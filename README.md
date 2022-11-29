# Decentralgraph

Almost in Beta!

More decentralized ways to explore the blockchain, ahoy!  This repo is the code running decentralgraph.com which lets you explore the Ethereum blockchain intuitively in 3D.  If you own an abnormal number of SSD's, you can run your own blockchain explorer while helping to secure them! 

## Running

You can run the frontend (see: [README.md](frontend/README.md) ) but the backend is trickier and a big TODO... but it's probably the frontend you were after to hack on anyway right?  Promise I'll Docker-ize the backend services one day!?

## Developer Docs

DG is a frontend Javascript browser application that talks to a number of backend components.  See [backend](backend/README.md) for more backend implementation details.  Likewise [frontend](frontend/README.md) has more web app details.  The frontend and backend all cache blockchain data where possible mostly out of thrift but also to run faster and pretty decently in offline mode.  The Graph is organized into GraphNodes (Addresses, Transactions, Blocks) that have Relations to other GraphNodes.  Both the backend and frontend share these concepts via types in the global folder as well as a GraphFetcher API interface that supports 2-way Websocket communication.


## Roadmap

A few more key features, then onward to new chains!:

- Parse ERC token history for all addresses, ERC-20, 721, etc.
- Feature to upload contract source to global Solidity registry
- Interlink Layer 2s (Arbitrum? Optimism?)
- Interlink Bitcoin chain

## Contributing

By all means, open a Pull Request if you have awesome changes.  It's early so your voice is but one of a few for informing what the app looks like.  You can also open an Issue if you'd like to talk a feature out before sweating over an implementation.

## TODO: Document a ton!
