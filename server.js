const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// Game rooms storage
const rooms = new Map();

// Card types mapping naar jouw nummering
const CARD_IMAGES = {
    'LEEUW': [1, 2, 3, 4, 5, 6, 7],
    'OLIFANT': [8, 9, 10, 11, 12, 13, 14],
    'LUIPAARD': [15, 16, 17, 18, 19, 20, 21],
    'BUFFEL': [22, 23, 24, 25, 26, 27, 28],
    'NEUSHOORN': [29, 30, 31, 32, 33, 34, 35],
    'COMBO_LEEUW_OLIFANT': [36],
    'COMBO_LEEUW_LUIPAARD': [37],
    'COMBO_BUFFEL_NEUSHOORN': [38],
    'COMBO_BUFFEL_LUIPAARD': [39],
    'COMBO_OLIFANT_NEUSHOORN': [40],
    'KAMELEON': [41, 42],
    'ZEBRA': [43, 44],
    'KROKODIL': [45, 46],
    'GIRAFFE': [47, 48],
    'AASGIER': [49, 50],
    'IJSBEER': [51, 52],
    'BIG_FIVE_SPOTTER': [53, 54]
};

class BigFiveGame {
    constructor(roomId) {
        this.roomId = roomId;
        this.players = [];
        this.deck = this.createDeck();
        this.shuffleDeck();
        this.gameState = {
            currentPlayer: 0,
            playAreas: [
                { cards: [], specialCards: [] },
                { cards: [], specialCards: [] },
                { cards: [], specialCards: [] }
            ],
            discardPile: [],
            winner: null
        };
    }

    createDeck() {
        const deck = [];
        let cardId = 0;

        // Big Five kaarten (7 van elk)
        const bigFive = ['LEEUW', 'OLIFANT', 'LUIPAARD', 'BUFFEL', 'NEUSHOORN'];
        bigFive.forEach(animal => {
            for (let i = 0; i < 7; i++) {
                deck.push({
                    id: `${animal}-${cardId++}`,
                    type: 'bigfive',
                    animal: animal,
                    imageNum: CARD_IMAGES[animal][i]
                });
            }
        });

        // Speciale kaarten (2 van elk)
        const specials = ['KAMELEON', 'ZEBRA', 'KROKODIL', 'GIRAFFE', 'AASGIER', 'IJSBEER', 'BIG_FIVE_SPOTTER'];
        specials.forEach(special => {
            for (let i = 0; i < 2; i++) {
                deck.push({
                    id: `${special}-${cardId++}`,
                    type: 'special',
                    special: special,
                    imageNum: CARD_IMAGES[special][i]
                });
            }
        });

        // Combinatiekaarten (1 van elk)
        const combinations = [
            ['LEEUW', 'OLIFANT'],
            ['LEEUW', 'LUIPAARD'],
            ['BUFFEL', 'NEUSHOORN'],
            ['BUFFEL', 'LUIPAARD'],
            ['OLIFANT', 'NEUSHOORN']
        ];
        combinations.forEach((combo, idx) => {
            const comboKey = `COMBO_${combo[0]}_${combo[1]}`;
            deck.push({
                id: `COMBO-${cardId++}`,
                type: 'combination',
                animals: combo,
                imageNum: CARD_IMAGES[comboKey][0]
            });
        });

        return deck;
    }

    shuffleDeck() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    dealCards() {
        // Elke speler krijgt 8 kaarten
        this.players.forEach(player => {
            player.hand = [];
            for (let i = 0; i < 8; i++) {
                if (this.deck.length > 0) {
                    player.hand.push(this.deck.pop());
                }
            }
        });
    }

    addPlayer(playerId, playerName) {
        if (this.players.length < 2) {
            this.players.push({
                id: playerId,
                name: playerName,
                hand: [],
                score: 0,
                position: 0
            });
            return true;
        }
        return false;
    }

    startGame() {
        if (this.players.length === 2) {
            this.dealCards();
            return true;
        }
        return false;
    }

    playCard(playerId, cardId, targetAreaId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== this.gameState.currentPlayer) {
            return { success: false, message: 'Niet jouw beurt!' };
        }

        const player = this.players[playerIndex];
        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        
        if (cardIndex === -1) {
            return { success: false, message: 'Kaart niet gevonden!' };
        }

        const card = player.hand[cardIndex];
        const area = this.gameState.playAreas[targetAreaId];

        // Check of de kaart kan worden geplaatst
        if (card.type === 'special') {
            if (area.specialCards.length >= 2) {
                return { success: false, message: 'Speciale kaart slots vol!' };
            }
            area.specialCards.push(card);
        } else {
            if (area.cards.length >= 5) {
                return { success: false, message: 'Speelvlak is vol!' };
            }
            area.cards.push(card);
        }

        // Verwijder kaart uit hand
        player.hand.splice(cardIndex, 1);

        // Trek nieuwe kaart als deck niet leeg is
        if (this.deck.length > 0) {
            player.hand.push(this.deck.pop());
        }

        // Check voor complete Big Five set
        this.checkForBigFive(targetAreaId);

        // Wissel beurt
        this.gameState.currentPlayer = (this.gameState.currentPlayer + 1) % 2;

        // Check winnaar
        this.checkWinner();

        return { success: true };
    }

    checkForBigFive(areaId) {
        const area = this.gameState.playAreas[areaId];
        const animals = new Set();

        // Tel alle Big Five dieren in dit speelvlak
        area.cards.forEach(card => {
            if (card.type === 'bigfive') {
                animals.add(card.animal);
            } else if (card.type === 'combination') {
                card.animals.forEach(a => animals.add(a));
            }
        });

        // Check voor complete Big Five (alle 5 dieren)
        const bigFive = ['LEEUW', 'OLIFANT', 'LUIPAARD', 'BUFFEL', 'NEUSHOORN'];
        const hasAllBigFive = bigFive.every(animal => animals.has(animal));

        if (hasAllBigFive && area.cards.length > 0) {
            // Geef 3 punten aan huidige speler
            const currentPlayer = this.players[this.gameState.currentPlayer];
            currentPlayer.score += 3;
            currentPlayer.position = Math.min(currentPlayer.score, 10);

            // Verplaats kaarten naar weglegstapel
            this.gameState.discardPile.push(...area.cards, ...area.specialCards);
            area.cards = [];
            area.specialCards = [];

            return true;
        }

        return false;
    }

    checkWinner() {
        this.players.forEach((player, idx) => {
            if (player.score >= 10) {
                this.gameState.winner = idx;
            }
        });
    }

    getGameStateForPlayer(playerId) {
        const state = JSON.parse(JSON.stringify(this.gameState));
        
        // Voeg speler data toe
        state.players = this.players.map((p, idx) => ({
            name: p.name,
            score: p.score,
            position: p.position,
            handCount: p.hand.length,
            hand: p.id === playerId ? p.hand : p.hand.map(() => ({ hidden: true, imageNum: 55 }))
        }));

        return state;
    }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Speler verbonden:', socket.id);

    socket.on('createRoom', ({ playerName }) => {
        const roomId = generateRoomCode();
        const game = new BigFiveGame(roomId);
        game.addPlayer(socket.id, playerName);
        rooms.set(roomId, game);
        
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, playerId: 0 });
    });

    socket.on('joinRoom', ({ roomId, playerName }) => {
        const game = rooms.get(roomId);
        
        if (!game) {
            socket.emit('error', { message: 'Room niet gevonden!' });
            return;
        }

        if (game.players.length >= 2) {
            socket.emit('error', { message: 'Room is vol!' });
            return;
        }

        game.addPlayer(socket.id, playerName);
        socket.join(roomId);
        socket.emit('roomJoined', { roomId, playerId: 1 });

        // Start het spel
        if (game.startGame()) {
            io.to(roomId).emit('gameStarted', {
                message: 'Spel gestart!'
            });

            // Stuur gamestate naar beide spelers
            game.players.forEach((player, idx) => {
                const playerSocket = io.sockets.sockets.get(player.id);
                if (playerSocket) {
                    playerSocket.emit('gameStateUpdated', {
                        gameState: game.getGameStateForPlayer(player.id),
                        yourPlayerId: idx
                    });
                }
            });
        }
    });

    socket.on('playCard', ({ roomId, playerId, cardId, targetAreaId }) => {
        const game = rooms.get(roomId);
        if (!game) return;

        const playerIndex = game.players.findIndex(p => p.id === socket.id);
        const result = game.playCard(socket.id, cardId, targetAreaId);

        if (result.success) {
            // Stuur updated gamestate naar beide spelers
            game.players.forEach((player) => {
                const playerSocket = io.sockets.sockets.get(player.id);
                if (playerSocket) {
                    const pIdx = game.players.findIndex(p => p.id === player.id);
                    playerSocket.emit('gameStateUpdated', {
                        gameState: game.getGameStateForPlayer(player.id),
                        yourPlayerId: pIdx
                    });
                }
            });
        } else {
            socket.emit('error', { message: result.message });
        }
    });

    socket.on('disconnect', () => {
        console.log('Speler disconnected:', socket.id);
        // Clean up rooms waar deze speler in zat
        rooms.forEach((game, roomId) => {
            const playerIndex = game.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                io.to(roomId).emit('playerDisconnected', {
                    message: `${game.players[playerIndex].name} heeft het spel verlaten`
                });
                rooms.delete(roomId);
            }
        });
    });
});

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

server.listen(PORT, () => {
    console.log(`🦁 Big Five server draait op poort ${PORT}`);
});
