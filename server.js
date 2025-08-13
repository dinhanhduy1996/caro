const http = require('http');
const WebSocket = require('ws');

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running\n');
});
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.on('message', (msg) => {
    console.log(`Received: ${msg}`);
    ws.send(`Echo: ${msg}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
const clients = new Map();
const games = new Map();



wss.on('connection', (ws) => {
    const id = uuidv4();
    const metadata = { id };
    clients.set(ws, metadata);
    console.log(`Client ${id} connected.`);
    ws.send(JSON.stringify({ type: 'your_id', id: id }));

    // Check for disconnected games
    for (let [gameId, game] of games.entries()) {
        if (game.disconnectedPlayer === id) {
            // Reconnect the player
            game.disconnectedPlayer = null; // Player reconnected
            const opponentId = game.players.find(pId => pId !== id);
            const opponentClient = findClientById(opponentId);

            // Notify opponent that player reconnected
            if (opponentClient && opponentClient.readyState === WebSocket.OPEN) {
                opponentClient.send(JSON.stringify({ type: 'opponent_reconnected', gameId }));
            }

            // Send game state to reconnected player
            ws.send(JSON.stringify({
                type: 'game_start',
                gameId: game.id,
                opponentId: opponentId,
                isMyTurn: game.turn === id,
                blockWinIfTwoEnds: game.blockWinIfTwoEnds,
                playerIndex: game.players.indexOf(id),
                board: game.board,
            }));
            break;
        }
    }

    broadcastPlayerList();

    ws.on('message', (messageAsString) => {
        const message = JSON.parse(messageAsString);
        const metadata = clients.get(ws);
        message.sender = metadata.id;

        console.log('Received message:', message);

        switch (message.type) {
            case 'invite':
                handleInvite(message);
                break;
            case 'invite_accepted':
                handleInviteAccepted(message);
                break;
            case 'invite_declined':
                handleInviteDeclined(message);
                break;
            case 'make_move':
                handleMakeMove(message);
                break;
            case 'request_undo':
                handleUndoRequest(message);
                break;
            case 'undo_response':
                handleUndoResponse(message);
                break;
            case 'play_again_request':
                handlePlayAgainRequest(message);
                break;
            case 'play_again_response':
                handlePlayAgainResponse(message);
                break;
            case 'request_yield_turn':
                handleRequestYieldTurn(message);
                break;
            case 'yield_turn_response':
                handleYieldTurnResponse(message);
                break;
            case 'reconnect_to_game':
                handleReconnectToGame(message);
                break;
            case 'player_leaving_game':
                handlePlayerLeavingGame(message);
                break;
            case 'chat_message':
                handleChatMessage(message);
                break;
            case 'send_emoji':
                handleSendEmoji(message);
                break;
            default:
                console.log(`Unknown message type: ${message.type}`);
        }
    });

    ws.on('close', () => {
        const metadata = clients.get(ws);
        console.log(`Client ${metadata.id} disconnected.`);
        clients.delete(ws);
        console.log(`Clients remaining: ${clients.size}`);

        // Notify opponent if in a game
        for (let [gameId, game] of games.entries()) {
            console.log(`Checking game ${gameId} for disconnected player ${metadata.id}`);
            if (game.players.includes(metadata.id) && !game.isOver) {
                console.log(`Player ${metadata.id} found in game ${gameId}`);
                game.disconnectedPlayer = metadata.id; // Mark the player as disconnected
                const opponentId = game.players.find(id => id !== metadata.id);
                const opponentClient = findClientById(opponentId);
                console.log(`Opponent ID: ${opponentId}, Opponent Client: ${opponentClient ? 'found' : 'not found'}`);
                if (opponentClient && opponentClient.readyState === WebSocket.OPEN) {
                    console.log(`Sending opponent_disconnected to ${opponentId}`);
                    opponentClient.send(JSON.stringify({ type: 'opponent_disconnected', gameId }));
                } else {
                    console.log(`Opponent client not open or not found for ${opponentId}`);
                }
                break;
            }
        }
        broadcastPlayerList();
    });

    ws.on('error', (error) => console.error('WebSocket error:', error));
});

function broadcastPlayerList() {
    const playerList = Array.from(clients.values()).map(meta => {
        const playerInfo = { id: meta.id };
        // Check if the player is in an ongoing game
        for (let [gameId, game] of games.entries()) {
            if (game.players.includes(meta.id) && !game.isOver) {
                playerInfo.gameId = gameId;
                playerInfo.opponentId = game.players.find(id => id !== meta.id);
                playerInfo.disconnected = game.disconnectedPlayer === meta.id;
                break;
            }
        }
        return playerInfo;
    });
    const message = { type: 'player_list', players: playerList };
    const messageString = JSON.stringify(message);
    clients.forEach((_, client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(messageString);
        }
    });
}

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function findClientById(id) {
    for (let [client, metadata] of clients.entries()) {
        if (metadata.id === id) return client;
    }
    return null;
}

function handleInvite(message) {
    const opponentClient = findClientById(message.opponentId);
    if (opponentClient && opponentClient.readyState === WebSocket.OPEN) {
        console.log(`Forwarding invite from ${message.sender} to ${message.opponentId}`);
        opponentClient.send(JSON.stringify({
            type: 'game_invite',
            from: message.sender,
            blockWinIfTwoEnds: message.blockWinIfTwoEnds
        }));
    }
}

function handleInviteAccepted(message) {
    const opponentId = message.from;
    const myId = message.sender;
    const opponentClient = findClientById(opponentId);
    const myClient = findClientById(myId);

    if (opponentClient && myClient) {
        const gameId = uuidv4();
        const game = {
            id: gameId,
            players: [opponentId, myId],
            blockWinIfTwoEnds: message.blockWinIfTwoEnds,
            board: Array(25 * 25).fill(null),
            turn: opponentId,
            isOver: false,
            lastMove: null,
            undoRequestFrom: null,
            playAgainRequestFrom: null,
        };
        games.set(gameId, game);

        const gameStartMessage = { type: 'game_start', gameId, opponentId: myId, blockWinIfTwoEnds: message.blockWinIfTwoEnds, isMyTurn: true, playerIndex: 0 };
        opponentClient.send(JSON.stringify(gameStartMessage));

        gameStartMessage.opponentId = opponentId;
        gameStartMessage.isMyTurn = false;
        gameStartMessage.playerIndex = 1;
        myClient.send(JSON.stringify(gameStartMessage));
    }
}

function handleInviteDeclined(message) {
    const opponentClient = findClientById(message.from);
    if (opponentClient) {
        opponentClient.send(JSON.stringify({ type: 'invite_declined', from: message.sender }));
    }
}

function handleMakeMove(message) {
    const { gameId, index } = message;
    const game = games.get(gameId);
    const playerId = message.sender;

    if (!game || game.turn !== playerId || game.board[index] !== null) return;

    const playerIndex = game.players.indexOf(playerId);
    game.board[index] = playerIndex;
    game.lastMove = { index, playerIndex };
    game.undoRequestFrom = null;

    const winner = checkWin(game.board, game.blockWinIfTwoEnds);
    if (winner !== null || !game.board.includes(null)) {
        game.isOver = true;
        const winnerId = winner !== null ? game.players[winner] : null;
        const gameOverMessage = { type: 'game_over', gameId, board: game.board, winner: null };
        game.players.forEach(id => {
            const client = findClientById(id);
            if (client) {
                gameOverMessage.winner = (id === winnerId) ? 'me' : (winnerId === null ? null : 'opponent');
                client.send(JSON.stringify(gameOverMessage));
            }
        });
        return;
    }

    game.turn = game.players.find(id => id !== playerId);
    const updateMessage = { type: 'move_made', gameId, board: game.board, nextTurn: game.turn, index: index };
    game.players.forEach(id => {
        const client = findClientById(id);
        if (client) client.send(JSON.stringify(updateMessage));
    });
}

function handlePlayAgainRequest(message) {
    const { gameId } = message;
    const game = games.get(gameId);
    const requesterId = message.sender;

    if (!game || !game.isOver) return;

    const opponentId = game.players.find(id => id !== requesterId);
    const opponentClient = findClientById(opponentId);

    if (opponentClient && opponentClient.readyState === WebSocket.OPEN) {
        opponentClient.send(JSON.stringify({ type: 'play_again_invite', gameId, from: requesterId }));
        game.playAgainRequestFrom = requesterId;
    } else {
        const requesterClient = findClientById(requesterId);
        if (requesterClient) {
            requesterClient.send(JSON.stringify({ type: 'opponent_disconnected', gameId }));
        }
    }
}

function handlePlayAgainResponse(message) {
    const { gameId, accepted } = message;
    const game = games.get(gameId);
    if (!game || !game.playAgainRequestFrom) return;

    const requesterId = game.playAgainRequestFrom;
    const responderId = message.sender;
    const requesterClient = findClientById(requesterId);
    const responderClient = findClientById(responderId);

    if (accepted) {
        game.board = Array(25 * 25).fill(null);
        game.isOver = false;
        game.turn = requesterId; // The one who requested plays first
        game.lastMove = null;
        game.playAgainRequestFrom = null;

        if (requesterClient) {
            requesterClient.send(JSON.stringify({
                type: 'game_reset',
                gameId,
                isMyTurn: true,
                playerIndex: game.players.indexOf(requesterId)
            }));
        }
        if (responderClient) {
            responderClient.send(JSON.stringify({
                type: 'game_reset',
                gameId,
                isMyTurn: false,
                playerIndex: game.players.indexOf(responderId)
            }));
        }
    } else {
        if (requesterClient) {
            requesterClient.send(JSON.stringify({ type: 'play_again_declined', gameId }));
        }
        games.delete(gameId);
    }
}

function handleUndoRequest(message) {
    const { gameId } = message;
    const game = games.get(gameId);
    const requesterId = message.sender;

    if (!game || game.isOver || !game.lastMove || game.players[game.lastMove.playerIndex] !== requesterId) return;

    const opponentId = game.players.find(id => id !== requesterId);
    const opponentClient = findClientById(opponentId);

    if (opponentClient && opponentClient.readyState === WebSocket.OPEN) {
        opponentClient.send(JSON.stringify({ type: 'undo_invite', gameId, from: requesterId }));
        game.undoRequestFrom = requesterId;
    }
}

function handleUndoResponse(message) {
    const { gameId, accepted } = message;
    const game = games.get(gameId);
    if (!game || !game.undoRequestFrom) return;

    const requesterId = game.undoRequestFrom;
    const requesterClient = findClientById(requesterId);

    if (accepted) {
        game.board[game.lastMove.index] = null;
        game.turn = requesterId;
        game.lastMove = null;
        game.undoRequestFrom = null;

        const updateMessage = { type: 'move_undone', gameId, board: game.board, nextTurn: game.turn };
        game.players.forEach(id => {
            const client = findClientById(id);
            if (client) client.send(JSON.stringify(updateMessage));
        });
    } else {
        if (requesterClient) requesterClient.send(JSON.stringify({ type: 'undo_declined', gameId }));
        game.undoRequestFrom = null;
    }
}

function handleYieldTurnResponse(message) {
    console.log('handleYieldTurnResponse received:', message);
    const { gameId, accepted } = message;
    const game = games.get(gameId);
    if (!game || !game.yieldTurnRequestFrom) {
        console.log('Yield turn response: game not found or no pending request.');
        return;
    }

    const requesterId = game.yieldTurnRequestFrom;
    const requesterClient = findClientById(requesterId);

    if (accepted) {
        console.log('Yield turn accepted.');
        const opponentId = game.players.find(id => id !== requesterId);
        game.turn = opponentId;

        const messageToSender = { type: 'turn_yielded', gameId, isMyTurn: false };
        if (requesterClient) requesterClient.send(JSON.stringify(messageToSender));

        const messageToOpponent = { type: 'turn_yielded', gameId, isMyTurn: true };
        const opponentClient = findClientById(opponentId);
        if (opponentClient) opponentClient.send(JSON.stringify(messageToOpponent));
    } else {
        console.log('Yield turn declined.');
        if (requesterClient) {
            requesterClient.send(JSON.stringify({ type: 'yield_turn_declined', gameId }));
        }
    }
    game.yieldTurnRequestFrom = null;
    console.log('Yield turn request cleared.');
}

function handleRequestYieldTurn(message) {
    console.log('handleRequestYieldTurn received:', message);
    const { gameId } = message;
    const game = games.get(gameId);
    const requesterId = message.sender;

    if (!game || game.turn !== requesterId || game.lastMove !== null) {
        console.log('Request yield turn: invalid state.');
        return;
    }

    const opponentId = game.players.find(id => id !== requesterId);
    const opponentClient = findClientById(opponentId);

    if (opponentClient && opponentClient.readyState === WebSocket.OPEN) {
        console.log(`Sending yield_turn_invite from ${requesterId} to ${opponentId}`);
        opponentClient.send(JSON.stringify({ type: 'yield_turn_invite', gameId, from: requesterId }));
        game.yieldTurnRequestFrom = requesterId;
    } else {
        console.log(`Opponent ${opponentId} not found or not open.`);
    }
}

function handleReconnectToGame(message) {
    const { gameId } = message;
    const game = games.get(gameId);
    const reconnectedPlayerId = message.sender;

    if (!game || !game.players.includes(reconnectedPlayerId)) return;

    game.disconnectedPlayer = null; // Player reconnected

    const opponentId = game.players.find(id => id !== reconnectedPlayerId);
    const opponentClient = findClientById(opponentId);

    // Notify opponent that player reconnected
    if (opponentClient && opponentClient.readyState === WebSocket.OPEN) {
        opponentClient.send(JSON.stringify({ type: 'opponent_reconnected', gameId }));
    }

    // Send game state to reconnected player
    const reconnectedClient = findClientById(reconnectedPlayerId);
    if (reconnectedClient && reconnectedClient.readyState === WebSocket.OPEN) {
        reconnectedClient.send(JSON.stringify({
            type: 'game_start',
            gameId: game.id,
            opponentId: opponentId,
            isMyTurn: game.turn === reconnectedPlayerId,
            blockWinIfTwoEnds: game.blockWinIfTwoEnds,
            playerIndex: game.players.indexOf(reconnectedPlayerId),
            board: game.board,
        }));
    }
    broadcastPlayerList();
}

function handlePlayerLeavingGame(message) {
    console.log('handlePlayerLeavingGame received:', message);
    const { gameId } = message;
    const playerId = message.sender;
    const game = games.get(gameId);

    if (!game || !game.players.includes(playerId) || game.isOver) {
        console.log('Player leaving game: invalid state.');
        return;
    }

    game.disconnectedPlayer = playerId; // Mark the player as disconnected
    const opponentId = game.players.find(id => id !== playerId);
    const opponentClient = findClientById(opponentId);

    if (opponentClient && opponentClient.readyState === WebSocket.OPEN) {
        console.log(`Sending opponent_disconnected to ${opponentId} because ${playerId} left.`);
        opponentClient.send(JSON.stringify({ type: 'opponent_disconnected', gameId }));
    } else {
        console.log(`Opponent client not open or not found for ${opponentId}.`);
    }
    broadcastPlayerList();
}

function handleChatMessage(message) {
    const { gameId, text } = message;
    const game = games.get(gameId);
    const senderId = message.sender;

    if (!game || !game.players.includes(senderId)) return;

    const opponentId = game.players.find(id => id !== senderId);
    const opponentClient = findClientById(opponentId);

    if (opponentClient && opponentClient.readyState === WebSocket.OPEN) {
        opponentClient.send(JSON.stringify({ 
            type: 'chat_message',
            gameId, 
            text 
        }));
    }
}

function handleSendEmoji(message) {
    const { gameId, emoji } = message;
    const game = games.get(gameId);
    const senderId = message.sender;

    if (!game || !game.players.includes(senderId)) return;

    const opponentId = game.players.find(id => id !== senderId);
    const opponentClient = findClientById(opponentId);

    if (opponentClient && opponentClient.readyState === WebSocket.OPEN) {
        opponentClient.send(JSON.stringify({ 
            type: 'send_emoji',
            gameId, 
            emoji 
        }));
    }
}

function checkWin(board, blockWinIfTwoEnds) {
    const size = 25;
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const player = board[r * size + c];
            if (player === null) continue;

            // Directions: horizontal, vertical, diag \, diag /
            const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
            for (const [dr, dc] of directions) {
                let count = 1;
                let blockedEnds = 0;

                // Check forward
                for (let i = 1; i < 5; i++) {
                    const newR = r + i * dr;
                    const newC = c + i * dc;
                    if (newR >= 0 && newR < size && newC >= 0 && newC < size && board[newR * size + newC] === player) {
                        count++;
                    } else {
                        if (newR >= 0 && newR < size && newC >= 0 && newC < size && board[newR * size + newC] !== null) {
                            blockedEnds++;
                        }
                        break;
                    }
                }

                // Check backward
                const backR = r - dr;
                const backC = c - dc;
                if (backR >= 0 && backR < size && backC >= 0 && backC < size && board[backR * size + backC] !== null && board[backR * size + backC] !== player) {
                    blockedEnds++;
                }

                if (count >= 5) {
                    if (blockWinIfTwoEnds && blockedEnds === 2) {
                        continue; // This win is blocked
                    }
                    return player; // We have a winner
                }
            }
        }
    }
    return null; // No winner
}