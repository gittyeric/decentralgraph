package commands

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/holiman/uint256"
	"github.com/ledgerwatch/erigon-lib/kv"
	"github.com/ledgerwatch/erigon/common"
	"github.com/ledgerwatch/erigon/common/hexutil"
	"github.com/ledgerwatch/erigon/consensus/ethash"
	"github.com/ledgerwatch/erigon/core/rawdb"
	"github.com/ledgerwatch/erigon/core/types"
	"github.com/ledgerwatch/erigon/internal/ethapi"
	"github.com/ledgerwatch/erigon/params"
	"github.com/ledgerwatch/erigon/turbo/rpchelper"

	"github.com/ledgerwatch/erigon/rpc"
)

// BlockReward returns the block reward for this block
// func (api *ErigonImpl) BlockReward(ctx context.Context, blockNr rpc.BlockNumber) (Issuance, error) {
//	tx, err := api.db.Begin(ctx, ethdb.RO)
//	if err != nil {
//		return Issuance{}, err
//	}
//	defer tx.Rollback()
//
//	return api.rewardCalc(tx, blockNr, "block") // nolint goconst
//}

// UncleReward returns the uncle reward for this block
// func (api *ErigonImpl) UncleReward(ctx context.Context, blockNr rpc.BlockNumber) (Issuance, error) {
//	tx, err := api.db.Begin(ctx, ethdb.RO)
//	if err != nil {
//		return Issuance{}, err
//	}
//	defer tx.Rollback()
//
//	return api.rewardCalc(tx, blockNr, "uncle") // nolint goconst
//}

// Issuance implements erigon_issuance. Returns the total issuance (block reward plus uncle reward) for the given block.
func (api *ErigonImpl) WatchTheBurn(ctx context.Context, blockNr rpc.BlockNumber) (Issuance, error) {
	tx, err := api.db.BeginRo(ctx)
	if err != nil {
		return Issuance{}, err
	}
	defer tx.Rollback()

	chainConfig, err := api.chainConfig(tx)
	if err != nil {
		return Issuance{}, err
	}
	if chainConfig.Ethash == nil {
		// Clique for example has no issuance
		return Issuance{}, nil
	}
	hash, err := rawdb.ReadCanonicalHash(tx, uint64(blockNr))
	if err != nil {
		return Issuance{}, err
	}
	header := rawdb.ReadHeader(tx, hash, uint64(blockNr))
	if header == nil {
		return Issuance{}, fmt.Errorf("could not find block header")
	}

	body := rawdb.ReadCanonicalBodyWithTransactions(tx, hash, uint64(blockNr))

	if body == nil {
		return Issuance{}, fmt.Errorf("could not find block body")
	}

	minerReward, uncleRewards := ethash.AccumulateRewards(chainConfig, header, body.Uncles)
	issuance := minerReward
	for _, r := range uncleRewards {
		p := r // avoids warning?
		issuance.Add(&issuance, &p)
	}

	var ret Issuance
	ret.BlockReward = (*hexutil.Big)(minerReward.ToBig())
	ret.Issuance = (*hexutil.Big)(issuance.ToBig())
	issuance.Sub(&issuance, &minerReward)
	ret.UncleReward = (*hexutil.Big)(issuance.ToBig())
	// Compute how much was burnt
	if header.BaseFee != nil {
		burnt := header.BaseFee
		burnt.Mul(burnt, big.NewInt(int64(header.GasUsed)))
		ret.Burnt = (*hexutil.Big)(burnt)
	} else {
		ret.Burnt = (*hexutil.Big)(big.NewInt(0))
	}
	// Compute totalIssued, totalBurnt and the supply of eth
	totalIssued, err := rawdb.ReadTotalIssued(tx, uint64(blockNr))
	if err != nil {
		return Issuance{}, err
	}
	totalBurnt, err := rawdb.ReadTotalBurnt(tx, uint64(blockNr))
	if err != nil {
		return Issuance{}, err
	}

	ret.TotalIssued = (*hexutil.Big)(totalIssued)
	ret.TotalBurnt = (*hexutil.Big)(totalBurnt)

	// Compute tips
	tips := big.NewInt(0)

	if header.BaseFee != nil {
		receipts, err := rawdb.ReadReceiptsByHash(tx, hash)
		if err != nil {
			return Issuance{}, err
		}

		baseFee, overflow := uint256.FromBig(header.BaseFee)
		if overflow {
			return Issuance{}, fmt.Errorf("baseFee overflow")
		}

		for i, transaction := range body.Transactions {
			tip := transaction.GetEffectiveGasTip(baseFee).ToBig()
			tips.Add(tips, tip.Mul(tip, big.NewInt(int64(receipts[i].GasUsed))))
		}
	}
	ret.Tips = (*hexutil.Big)(tips)
	return ret, nil
}

func (api *ErigonImpl) GetBlockNode(ctx context.Context, minBlockNumber rpc.BlockNumber, maxBlockNumber rpc.BlockNumber) (interface{}, error) {
	r := api.getBlocksTransactions(ctx, minBlockNumber, maxBlockNumber, 0, 1023) //api.eth.GetBlockByNumber(ctx, minBlockNumber, true)
	return r, nil
}

func (api *ErigonImpl) getBlocksTransactions(ctx context.Context, minNumber rpc.BlockNumber, maxNumber rpc.BlockNumber, pageNumber uint16, pageSize uint16) interface{} {
	r := make(chan map[string]map[string]interface{})

	allBalances := make(map[string]interface{})
	batch := make([]map[string]map[string]interface{}, 1+maxNumber-minNumber)
	latestNumber, _ := api.eth.BlockNumber(ctx)
	latestBn := rpc.BlockNumber(latestNumber)
	for i := minNumber; i <= maxNumber; i++ {
		go func() {
			//defer close(r)
			//fmt.Println("Running sub")
			res, _ := api.getBlockTransactions(ctx, i, 0, 1023, latestBn)
			//fmt.Println("Sub run!")
			//fmt.Println("Sending response")

			r <- res
		}()
	}
	for i := minNumber; i <= maxNumber; i++ {
		batch[i-minNumber] = <-r
	}
	for i := minNumber; i <= maxNumber; i++ {
		bals := batch[i-minNumber]["balances"]
		for k, v := range bals {
			allBalances[k] = v
			delete(bals, k)
		}
	}
	response := make(map[string]interface{})
	response["blocks"] = batch
	response["balances"] = allBalances

	return response
}

func (api *ErigonImpl) getBlockTransactions(ctx context.Context, number rpc.BlockNumber, pageNumber uint16, pageSize uint16, latestBn rpc.BlockNumber) (map[string]map[string]interface{}, error) {
	tx, err := api.db.BeginRo(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	balances := make(map[string]interface{})
	b, senders, err := api.getBlockWithSenders(ctx, number, tx)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, nil
	}

	chainConfig, err := api.chainConfig(tx)
	if err != nil {
		return nil, err
	}

	getBlockRes, err := api.delegateGetBlockByNumber(tx, b, number, true)
	if err != nil {
		return nil, err
	}

	// Receipts
	receipts, err := api.getReceipts(ctx, tx, chainConfig, b, senders)

	//fmt.Println("Got basics")
	// Create a map of address -> balance, sized big enough
	// for all transaction*2 + 1 miner addresses
	miner := b.Coinbase()
	//fmt.Println("Got latest block")

	minerBalance, _ := api.eth.GetBalance(ctx, miner, rpc.BlockNumberOrHash{BlockNumber: &latestBn})
	balances[strings.ToLower(miner.Hex())] = minerBalance
	//fmt.Println("Got miner")

	if err != nil {
		return nil, fmt.Errorf("getReceipts error: %v", err)
	}

	btxns := b.Transactions()
	smolTrans := make([]map[string]interface{}, len(btxns))
	for i, receipt := range receipts {
		txn := btxns[i]
		smolT := make(map[string]interface{})
		sender, _ := txn.Sender(types.Signer{})
		//fmt.Println("Got sender")
		txBalance, _ := api.eth.GetBalance(ctx, sender, rpc.BlockNumberOrHash{BlockNumber: &latestBn})
		balances[strings.ToLower(sender.Hex())] = txBalance
		smolT["from"] = strings.ToLower(sender.Hex())
		smolT["hash"] = strings.ToLower(txn.Hash().Hex())
		smolT["value"] = strings.ToLower(txn.GetValue().Hex())
		//fmt.Println("Got tx balances")

		if &receipt.ContractAddress != nil {
			//fmt.Println("Getting contract")
			contractBalance, _ := api.eth.GetBalance(ctx, receipt.ContractAddress, rpc.BlockNumberOrHash{BlockNumber: &latestBn})
			balances[strings.ToLower(receipt.ContractAddress.Hex())] = contractBalance
			smolT["t"] = "c"
			smolT["to"] = receipt.ContractAddress.Hex()
		}

		receiver := txn.GetTo()
		//fmt.Println("Got receiver")
		if receiver != nil {
			//fmt.Println("Fetching rx")
			rxBalance, _ := api.eth.GetBalance(ctx, *receiver, rpc.BlockNumberOrHash{BlockNumber: &latestBn})
			balances[strings.ToLower(receiver.Hex())] = rxBalance
			smolT["t"] = "w"
			smolT["to"] = receiver.Hex()
		}

		smolTrans[i] = smolT
	}

	// Pruned block attrs

	prunedBlock := map[string]interface{}{}
	for _, k := range []string{"timestamp", "miner", "baseFeePerGas", "number"} {
		prunedBlock[k] = getBlockRes[k]
	}

	// Crop tx input to 4bytes
	var txs = getBlockRes["transactions"].([]interface{})
	for _, rawTx := range txs {
		rpcTx := rawTx.(*ethapi.RPCTransaction)
		if len(rpcTx.Input) >= 4 {
			rpcTx.Input = rpcTx.Input[:4]
		}
	}

	response := make(map[string]map[string]interface{})
	prunedBlock["transactions"] = smolTrans
	response["fullblock"] = prunedBlock
	response["balances"] = balances
	return response, nil
}

func (api *ErigonImpl) delegateBlockFees(ctx context.Context, tx kv.Tx, block *types.Block, senders []common.Address, chainConfig *params.ChainConfig) (uint64, error) {
	receipts, err := api.getReceipts(ctx, tx, chainConfig, block, senders)
	if err != nil {
		return 0, fmt.Errorf("getReceipts error: %v", err)
	}

	fees := uint64(0)
	for _, receipt := range receipts {
		txn := block.Transactions()[receipt.TransactionIndex]
		effectiveGasPrice := uint64(0)
		if !chainConfig.IsLondon(block.NumberU64()) {
			effectiveGasPrice = txn.GetPrice().Uint64()
		} else {
			baseFee, _ := uint256.FromBig(block.BaseFee())
			gasPrice := new(big.Int).Add(block.BaseFee(), txn.GetEffectiveGasTip(baseFee).ToBig())
			effectiveGasPrice = gasPrice.Uint64()
		}
		fees += effectiveGasPrice * receipt.GasUsed
	}

	return fees, nil
}

func (api *ErigonImpl) delegateGetBlockByNumber(tx kv.Tx, b *types.Block, number rpc.BlockNumber, inclTx bool) (map[string]interface{}, error) {
	td, err := rawdb.ReadTd(tx, b.Hash(), b.NumberU64())
	if err != nil {
		return nil, err
	}
	response, err := ethapi.RPCMarshalBlock(b, inclTx, inclTx)
	response["totalDifficulty"] = (*hexutil.Big)(td)
	response["transactionCount"] = b.Transactions().Len()

	if err == nil && number == rpc.PendingBlockNumber {
		// Pending blocks need to nil out a few fields
		for _, field := range []string{"hash", "nonce", "miner"} {
			response[field] = nil
		}
	}

	// Explicitly drop unwanted fields
	response["logsBloom"] = nil
	return response, err
}

func (api *ErigonImpl) getBlockWithSenders(ctx context.Context, number rpc.BlockNumber, tx kv.Tx) (*types.Block, []common.Address, error) {
	if number == rpc.PendingBlockNumber {
		return api.pendingBlock(), nil, nil
	}

	n, hash, _, err := rpchelper.GetBlockNumber(rpc.BlockNumberOrHashWithNumber(number), tx, api.filters)
	if err != nil {
		return nil, nil, err
	}

	block, senders, err := api._blockReader.BlockWithSenders(ctx, tx, hash, n)
	return block, senders, err
}

type FullAddress struct {
	Address common.Address `json: address`
	Eth     *hexutil.Big   `json: eth`
}

type BlockNode struct {
	BlockReward *hexutil.Big `json:"blockReward"` // Block reward for given block
	UncleReward *hexutil.Big `json:"uncleReward"` // Uncle reward for gived block
	Issuance    *hexutil.Big `json:"issuance"`    // Total amount of wei created in the block
	Burnt       *hexutil.Big `json:"burnt"`       // Total amount of wei burned in the block
	TotalIssued *hexutil.Big `json:"totalIssued"` // Total amount of wei created in total so far
	TotalBurnt  *hexutil.Big `json:"totalBurnt"`  // Total amount of wei burnt so far
	Tips        *hexutil.Big `json:"tips"`        // Total Tips generated by the block
}

// Issuance structure to return information about issuance
type Issuance struct {
	BlockReward *hexutil.Big `json:"blockReward"` // Block reward for given block
	UncleReward *hexutil.Big `json:"uncleReward"` // Uncle reward for gived block
	Issuance    *hexutil.Big `json:"issuance"`    // Total amount of wei created in the block
	Burnt       *hexutil.Big `json:"burnt"`       // Total amount of wei burned in the block
	TotalIssued *hexutil.Big `json:"totalIssued"` // Total amount of wei created in total so far
	TotalBurnt  *hexutil.Big `json:"totalBurnt"`  // Total amount of wei burnt so far
	Tips        *hexutil.Big `json:"tips"`        // Total Tips generated by the block
}
