const express = require('express');
const http = require('http');
const socketIO = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

const rooms = new Map();

// Kaart afbeeldingen mapping
const CARD_IMAGES = {
    'LEEUW': [1, 2, 3, 4, 5, 6, 7],
    'OLIFANT': [8, 9, 10, 11, 12, 13, 14],
    'LUIPAARD': [15, 16, 17, 18, 19, 20, 21],
    'BUFFEL': [22, 23, 24, 25, 26, 27, 28],
    'NEUSHOORN': [29, 30, 31, 32, 33, 34, 35],
    'COMBO_LEEUW_OLIFANT': 36,
    'COMBO_LEEUW_LUIPAARD': 37,
    'COMBO_BUFFEL_NEUSHOORN': 38,
    'COMBO_BUFFEL_LUIPAARD': 39,
    'COMBO_OLIFANT_NEUSHOORN': 40,
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
                { cards: [], specialCards: [], blocked: false },
                { cards: [], specialCards: [], blocked: false },
                { cards: [], specialCards: [], blocked: false }
            ],
            discardPile: [],
            deckCount: 0,
            winner: null,
            lastPlayedCard: null
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
                    imageNum: CARD_IMAGES[animal][i],
                    owner: null
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
                    imageNum: CARD_IMAGES[special][i],
                    owner: null
                });
            }
        });

        // Combinatiekaarten (1 van elk)
        const combinations = [
            { animals: ['LEEUW', 'OLIFANT'], key: 'COMBO_LEEUW_OLIFANT' },
            { animals: ['LEEUW', 'LUIPAARD'], key: 'COMBO_LEEUW_LUIPAARD' },
            { animals: ['BUFFEL', 'NEUSHOORN'], key: 'COMBO_BUFFEL_NEUSHOORN' },
            { animals: ['BUFFEL', 'LUIPAARD'], key: 'COMBO_BUFFEL_LUIPAARD' },
            { animals: ['OLIFANT', 'NEUSHOORN'], key: 'COMBO_OLIFANT_NEUSHOORN' }
        ];
        
        combinations.forEach(combo => {
            deck.push({
                id: `COMBO-${cardId++}`,
                type: 'combination',
                animals: combo.animals,
                imageNum: CARD_IMAGES[combo.key],
                owner: null
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
        this.gameState.deckCount = this.deck.length;
    }

    addPlayer(playerId, playerName) {
        if (this.players.length < 2) {
            this.players.push({
                id: playerId,
                name: playerName,
                hand: [],
                score: 0,
                position: 0,
                frozen: false
            });
            return true;
        }
        return false;
    }

    startGame() {
        if (this.players.length === 2) {
            this.dealCards();
            this.gameState.deckCount = this.deck.length;
            return true;
        }
        return false;
    }

    drawCard(playerId) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex === -1) return { success: false, message: 'Speler niet gevonden' };

        if (this.deck.length > 0) {
            const card = this.deck.pop();
            this.players[playerIndex].hand.push(card);
            this.gameState.deckCount = this.deck.length;
            return { success: true, card: card };
        }

        return { success: false, message: 'Deck is leeg!' };
    }

    playCard(playerId, cardId, targetAreaId, extraData = {}) {
        const playerIndex = this.players.findIndex(p => p.id === playerId);
        if (playerIndex !== this.gameState.currentPlayer) {
            return { success: false, message: 'Niet jouw beurt!' };
        }

        const player = this.players[playerIndex];
        
        // Check of speler bevroren is (IJsbeer effect)
        if (player.frozen) {
            player.frozen = false;
            this.gameState.currentPlayer = (this.gameState.currentPlayer + 1) % 2;
            return { 
                success: true, 
                skipTurn: true, 
                specialEffect: `❄️ Je bent bevroren! Beurt overgeslagen.` 
            };
        }

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        
        if (cardIndex === -1) {
            return { success: false, message: 'Kaart niet gevonden!' };
        }

        const card = player.hand[cardIndex];
        const area = this.gameState.playAreas[targetAreaId];

        // Check of area geblokkeerd is
        if (area.blocked) {
            return { success: false, message: 'Dit speelvlak is geblokkeerd!' };
        }

        let specialEffect = null;
        const opponent = this.players[(playerIndex + 1) % 2];

        // Speciale kaart effecten VOOR plaatsing
        if (card.type === 'special') {
            switch(card.special) {
                case 'KROKODIL':
                    // Steel een willekeurige kaart van tegenstander
                    if (opponent.hand.length > 0) {
                        const stolenIndex = Math.floor(Math.random() * opponent.hand.length);
                        const stolenCard = opponent.hand.splice(stolenIndex, 1)[0];
                        player.hand.push(stolenCard);
                        specialEffect = `🐊 KROKODIL: Je hebt een kaart gestolen van ${opponent.name}!`;
                        console.log(`🐊 ${player.name} steelt kaart van ${opponent.name}`);
                    }
                    break;

                case 'AASGIER':
                    // Pak een kaart uit de weglegstapel
                    if (this.gameState.discardPile.length > 0) {
                        const salvaged = this.gameState.discardPile.pop();
                        player.hand.push(salvaged);
                        const cardName = salvaged.type === 'bigfive' ? salvaged.animal : 
                                        salvaged.type === 'special' ? salvaged.special : 'COMBO';
                        specialEffect = `🦅 AASGIER: Je hebt ${cardName} teruggehaald uit de weglegstapel!`;
                        console.log(`🦅 ${player.name} pakt ${cardName} uit discard pile`);
                    }
                    break;

                case 'GIRAFFE':
                    // Kijk naar de top 3 kaarten van het deck
                    const topCards = this.deck.slice(-3).reverse();
                    const cardNames = topCards.map(c => 
                        c.type === 'bigfive' ? c.animal : 
                        c.type === 'special' ? c.special : 'COMBO'
                    ).join(', ');
                    specialEffect = `🦒 GIRAFFE: De volgende kaarten zijn: ${cardNames || 'Geen kaarten meer'}`;
                    console.log(`🦒 ${player.name} kijkt naar top 3: ${cardNames}`);
                    break;

                case 'IJSBEER':
                    // Bevries tegenstander (sla volgende beurt over)
                    opponent.frozen = true;
                    specialEffect = `🐻‍❄️ IJSBEER: ${opponent.name} is bevroren en slaat de volgende beurt over!`;
                    console.log(`🐻‍❄️ ${player.name} bevriest ${opponent.name}`);
                    break;

                case 'ZEBRA':
                    // Blokkeer een speelvlak voor tegenstander (dit speelvlak)
                    area.blockedForPlayer = (playerIndex + 1) % 2;
                    specialEffect = `🦓 ZEBRA: Dit speelvlak is geblokkeerd voor ${opponent.name}! (+ dubbele punten bij Big Five)`;
                    console.log(`🦓 ${player.name} blokkeert speelvlak ${targetAreaId + 1}`);
                    break;
            }
        }

        // ZET OWNER EN PLAATS DE KAART
        card.owner = playerIndex; // OWNER TRACKING
        
        if (card.type === 'special') {
            if (area.specialCards.length >= 2) {
                return { success: false, message: 'Speciale slots zijn vol!' };
            }
            area.specialCards.push(card);
        } else {
            if (area.cards.length >= 5) {
                return { success: false, message: 'Speelvlak is vol (max 5 kaarten)!' };
            }
            area.cards.push(card);
        }

        // Verwijder kaart uit hand
        player.hand.splice(cardIndex, 1);

        // Trek nieuwe kaart als deck niet leeg is
        if (this.deck.length > 0) {
            player.hand.push(this.deck.pop());
            this.gameState.deckCount = this.deck.length;
        }

        // Sla laatste gespeelde kaart op
        this.gameState.lastPlayedCard = card;

        // Check voor complete Big Five set
        const bigFiveResult = this.checkForBigFive(targetAreaId, playerIndex);
        
        if (bigFiveResult.completed) {
            // Basis punten: 3
            let points = 3;
            let bonusMessage = '';

            // ZEBRA BONUS: Dubbele punten als Zebra in het speelvlak zit
            if (bigFiveResult.hasZebra) {
                points *= 2;
                bonusMessage = ' 🦓 (x2 door Zebra!)';
                console.log(`🦓 ZEBRA BONUS: Punten verdubbeld naar ${points}!`);
            }

            player.score += points;
            player.position = Math.min(player.score, 10);
            
            const bigFiveEffect = `🏆 BIG FIVE COMPLEET! ${player.name} scoort ${points} punten${bonusMessage}`;
            console.log(bigFiveEffect);
            
            // Verwijder kaarten naar discard pile
            this.gameState.discardPile.push(...area.cards, ...area.specialCards);
            area.cards = [];
            area.specialCards = [];
            area.blocked = false;
            area.blockedForPlayer = null;

            // Combineer special effects
            if (specialEffect) {
                specialEffect = `${specialEffect}\n\n${bigFiveEffect}`;
            } else {
                specialEffect = bigFiveEffect;
            }
        }

        // Reset blokkering na beurt (alleen voor andere speelvlakken)
        this.gameState.playAreas.forEach((a, idx) => {
            if (idx !== targetAreaId && a.blockedForPlayer === playerIndex) {
                a.blocked = false;
                a.blockedForPlayer = null;
            }
        });

        // Wissel beurt
        this.gameState.currentPlayer = (this.gameState.currentPlayer + 1) % 2;

        // Check winnaar
        this.checkWinner();

        return { 
            success: true, 
            bigFiveCompleted: bigFiveResult.completed,
            specialEffect: specialEffect,
            points: bigFiveResult.completed ? (bigFiveResult.hasZebra ? 6 : 3) : 0
        };
    }

    checkForBigFive(areaId, playerIndex) {
        const area = this.gameState.playAreas[areaId];
        const animals = new Set();
        let hasZebra = false;
        let hasKameleon = false;
        let hasBigFiveSpotter = false;

        // Verzamel alle Big Five dieren
        area.cards.forEach(card => {
            if (card.type === 'bigfive') {
                animals.add(card.animal);
            } else if (card.type === 'combination') {
                card.animals.forEach(a => animals.add(a));
            }
        });

        // Check speciale kaarten
        area.specialCards.forEach(card => {
            if (card.type === 'special') {
                switch(card.special) {
                    case 'ZEBRA':
                        hasZebra = true;
                        break;
                    
                    case 'KAMELEON':
                        hasKameleon = true;
                        break;
                    
                    case 'BIG_FIVE_SPOTTER':
                        hasBigFiveSpotter = true;
                        break;
                }
            }
        });

        // Kameleon of Big Five Spotter: vult ontbrekend dier aan (bij 4 van 5)
        if ((hasKameleon || hasBigFiveSpotter) && animals.size === 4) {
            const bigFive = ['LEEUW', 'OLIFANT', 'LUIPAARD', 'BUFFEL', 'NEUSHOORN'];
            const missing = bigFive.find(animal => !animals.has(animal));
            if (missing) {
                animals.add(missing);
                const cardType = hasKameleon ? 'Kameleon 🦎' : 'Big Five Spotter 🔭';
                console.log(`${cardType} vult ontbrekend dier aan: ${missing}`);
            }
        }

        // Check voor complete Big Five (alle 5 dieren)
        const bigFive = ['LEEUW', 'OLIFANT', 'LUIPAARD', 'BUFFEL', 'NEUSHOORN'];
        const hasAllBigFive = bigFive.every(animal => animals.has(animal));
        const completed = hasAllBigFive && area.cards.length > 0;

        if (completed) {
            console.log(`✅ Big Five compleet! Dieren: ${Array.from(animals).join(', ')}`);
        }

        return { 
            completed, 
            hasZebra,
            animals: Array.from(animals)
        };
    }

    checkWinner() {
        this.players.forEach((player, idx) => {
            if (player.score >= 10) {
                this.gameState.winner = idx;
                console.log(`🎉 ${player.name} heeft gewonnen met ${player.score} punten!`);
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
            frozen: p.frozen,
            hand: p.id === playerId 
                ? p.hand // Eigen kaarten tonen
                : p.hand.map(() => ({ hidden: true, imageNum: 55 })) // Tegenstander: achterkant (kaart 55)
        }));

        return state;
    }
}

// Socket.IO handling
io.on('connection', (socket) => {
    console.log('✅ Speler verbonden:', socket.id);

    socket.on('createRoom', ({ playerName }) => {
        const roomId = generateRoomCode();
        const game = new BigFiveGame(roomId);
        game.addPlayer(socket.id, playerName);
        rooms.set(roomId, game);
        
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, playerId: 0 });
        console.log(`🎮 Room ${roomId} aangemaakt door ${playerName}`);
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

        console.log(`👥 ${playerName} joined room ${roomId}`);

        // Start het spel
        if (game.startGame()) {
            console.log(`🎲 Spel gestart in room ${roomId}`);
            console.log(`📊 Deck bevat ${game.gameState.deckCount} kaarten`);
            
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

    socket.on('playCard', ({ roomId, cardId, targetAreaId, extraData }) => {
        const game = rooms.get(roomId);
        if (!game) return;

        const result = game.playCard(socket.id, cardId, targetAreaId, extraData);

        if (result.success) {
            const player = game.players[game.gameState.currentPlayer === 0 ? 1 : 0];
            console.log(`🃏 ${player.name} speelt kaart ${cardId} naar speelvlak ${targetAreaId + 1}`);
            
            if (result.specialEffect) {
                console.log(`✨ ${result.specialEffect}`);
            }

            if (result.bigFiveCompleted) {
                console.log(`🎯 ${player.name} heeft ${result.points} punten gescoord!`);
            }

            // Stuur updated gamestate naar beide spelers
            game.players.forEach((player) => {
                const playerSocket = io.sockets.sockets.get(player.id);
                if (playerSocket) {
                    const pIdx = game.players.findIndex(p => p.id === player.id);
                    playerSocket.emit('gameStateUpdated', {
                        gameState: game.getGameStateForPlayer(player.id),
                        yourPlayerId: pIdx,
                        specialEffect: result.specialEffect
                    });
                }
            });

            // Check winner
            if (game.gameState.winner !== null) {
                const winner = game.players[game.gameState.winner];
                console.log(`👑 ${winner.name} wint het spel met ${winner.score} punten!`);
            }
        } else if (result.skipTurn) {
            // Beurt overgeslagen door IJsbeer
            game.players.forEach((player) => {
                const playerSocket = io.sockets.sockets.get(player.id);
                if (playerSocket) {
                    const pIdx = game.players.findIndex(p => p.id === player.id);
                    playerSocket.emit('gameStateUpdated', {
                        gameState: game.getGameStateForPlayer(player.id),
                        yourPlayerId: pIdx,
                        specialEffect: result.specialEffect
                    });
                }
            });
        } else {
            socket.emit('error', { message: result.message });
        }
    });

    socket.on('drawCard', ({ roomId }) => {
        const game = rooms.get(roomId);
        if (!game) return;

        const result = game.drawCard(socket.id);
        if (result.success) {
            console.log(`🎴 Kaart getrokken uit deck`);
            
            // Update gamestate
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
        console.log('❌ Speler disconnected:', socket.id);
        
        rooms.forEach((game, roomId) => {
            const playerIndex = game.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                io.to(roomId).emit('playerDisconnected', {
                    message: `${game.players[playerIndex].name} heeft het spel verlaten`
                });
                rooms.delete(roomId);
                console.log(`🗑️ Room ${roomId} verwijderd`);
            }
        });
    });
});

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

server.listen(PORT, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🦁 BIG FIVE - SAFARI KAARTSPEL SERVER`);
    console.log(`${'='.repeat(60)}`);
    console.log(`📡 Server draait op poort: ${PORT}`);
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
    console.log(`${'='.repeat(60)}\n`);
    
    console.log(`✨ Spelregels actief:\n`);
    console.log(`📋 BASIS:`);
    console.log(`   • 2 spelers, 8 kaarten per speler`);
    console.log(`   • 3 speelvlakken: 5 normale + 2 speciale slots`);
    console.log(`   • Complete Big Five = 3 punten`);
    console.log(`   • Eerste naar 10 punten wint\n`);
    
    console.log(`🎴 SPECIALE KAARTEN:`);
    console.log(`   🦎 KAMELEON - Joker voor ontbrekend Big Five dier (bij 4/5)`);
    console.log(`   🦓 ZEBRA - Dubbele punten (3→6) + blokkeer speelvlak`);
    console.log(`   🐊 KROKODIL - Steel willekeurige kaart van tegenstander`);
    console.log(`   🦒 GIRAFFE - Bekijk top 3 kaarten van deck`);
    console.log(`   🦅 AASGIER - Pak 1 kaart terug uit weglegstapel`);
    console.log(`   🐻‍❄️ IJSBEER - Bevries tegenstander (skip 1 beurt)`);
    console.log(`   🔭 BIG FIVE SPOTTER - Completeer set met 4 dieren\n`);
    
    console.log(`🔒 PRIVACY:`);
    console.log(`   • Tegenstander ziet kaart 55 (achterkant)`);
    console.log(`   • Owner tracking actief`);
    console.log(`   • Hand altijd privé\n`);
    
    console.log(`${'='.repeat(60)}\n`);
});
