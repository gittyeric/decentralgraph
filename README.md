# Decentralgraph

Now in [Beta](https://decentralgraph.com)!

More decentralized ways to explore the blockchain, ahoy!  This repo is the code running [decentralgraph.com](https://decentralgraph.com) which lets you explore the Ethereum blockchain intuitively in 3D.  If you own a few solid SSD's, you can run your own blockchain explorer while helping to secure decentralized networks!

## System Requirements

Unfortunately spinning up an entire Ethereum Archive node is not cheap, but just about any decent laptop can handle the Goerli test network, which this README biases toward for developers seeking to test changes quickly.  Replace `goerli` with `mainnet` in any of the instructions to run Decentralgraph against the real Ethereum network.

### Requirements for Erigon/Lighthouse/Core/Bridge services

A decent laptop can run all of Decentralgraph against small test networks, but for production Ethereum, you'll require:

All the major services should run on the same machine for sheer disk/network performance concerns, which unfornuately means fairly beefy machines:

1. A decent CPU, 8 cores or more at 3Ghz should do but up to 16 5Ghz cores can help a ton
2. You MUST have at least 2 fast SSDs each at 4Tb or more (as of July 2023, this will grow over time!), but even better is 3 total with 2 of them configured in RAID-0 as Decentralgraph's index read/writes will always be the bottleneck for both chain indexing and web app responses.
3. 32Gb-128Gb of RAM.  Yep, that's right, nothing much to do about it unless you run the Erigon/Lighthouse clients on a separate machine from the Decentralgraph services, which is not recommended.  You REALLY want at least 64Gb of RAM since most services rely heavily on OS memory caching of disk files.

### Requirements for optional Edge service

The edge service is just a memory cache proxy, so 1 core at 2Ghz or more and 4Gb of memory is enough, though you can optionally use more memory for better caching performance.

### Running in Docker

Currently only running Decentralgraph is Docker is supported since there's so many moving parts.  After cloning this repository and changing to the root of this directory, you can start a number of profiles that let you customize the environment

You can start with the Core and it's dependencies (Erigon, Lighthouse) from comand line assuming you have a recent Docker / Docker Compose installed:

`docker-compose up --profile goerli`

Then kick up your heels for awhile while you sync with the test Goreli network.  You can replace `goerli` with `mainnet` to sync with the main Ethereum production network but this takes a few days and a ton of SSD disk space (see [System Requirements](#system-requirements))!

Waaayyyy after indexing is done you can visit [http://frontend:8080](http://frontend:8080) to start exploring!

##### Production config tips for Performance

For production indexing you'll need to set which physical disks will be used for which purposes.  You can use up to 3 SSD/NVMe partitions, your fastest being used for "Core", the other 2 being used for Erigon and Lighthouse.  Using the same disk for Erigon/Lighthouse is acceptable but much slower during initial chain indexing.

This project draws a clean abstraction line by letting you mount the 2 (or 3) partitions to Docker by specifying them in 


#### (Optional): Scaling with Edge nodes

Edge nodes duplicate the Bridge API by implementing a simple memory cache proxy to a Bridge, so the more Edges you have running, the less you need to hit Bridge and use precious disk I/O on your expensive Core server.  Edge is not intended to run on the same machine as Core but you can do it for testing by running:


`docker-compose up -it --profile edge --profile goerli --profile webapp`

To run an Edge by itself, use:

`docker-compose up edge -e BRIDGE_URL=http://localhost:`

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

