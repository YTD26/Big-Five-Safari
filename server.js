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
                { cards: [], specialCards: [], blocked: false, blockedForPlayer: null },
                { cards: [], specialCards: [], blocked: false, blockedForPlayer: null },
                { cards: [], specialCards: [], blocked: false, blockedForPlayer: null }
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
                specialEffect: `❄️ ${player.name} is bevroren! Beurt overgeslagen.` 
            };
        }

        const cardIndex = player.hand.findIndex(c => c.id === cardId);
        
        if (cardIndex === -1) {
            return { success: false, message: 'Kaart niet gevonden!' };
        }

        const card = player.hand[cardIndex];
        const area = this.gameState.playAreas[targetAreaId];

        // Check of area geblokkeerd is voor deze speler
        if (area.blocked && area.blockedForPlayer === playerIndex) {
            return { success: false, message: 'Dit speelvlak is geblokkeerd door tegenstander!' };
        }

        let specialEffect = null;
        const opponent = this.players[(playerIndex + 1) % 2];

        // Speciale kaart effecten VOOR plaatsing
        if (card.type === 'special') {
            switch(card.special) {
                case 'KROKODIL':
                    if (opponent.hand.length > 0) {
                        const stolenIndex = Math.floor(Math.random() * opponent.hand.length);
                        const stolenCard = opponent.hand.splice(stolenIndex, 1)[0];
                        player.hand.push(stolenCard);
                        const cardName = stolenCard.type === 'bigfive' ? stolenCard.animal : 
                                        stolenCard.type === 'special' ? stolenCard.special : 'COMBO';
                        specialEffect = `🐊 KROKODIL: ${player.name} steelt ${cardName} van ${opponent.name}!`;
                        console.log(`🐊 ${player.name} steelt ${cardName} van ${opponent.name}`);
                    } else {
                        specialEffect = `🐊 KROKODIL: ${opponent.name} heeft geen kaarten meer!`;
                    }
                    break;

                case 'AASGIER':
                    if (this.gameState.discardPile.length > 0) {
                        const salvaged = this.gameState.discardPile.pop();
                        player.hand.push(salvaged);
                        const cardName = salvaged.type === 'bigfive' ? salvaged.animal : 
                                        salvaged.type === 'special' ? salvaged.special : 'COMBO';
                        specialEffect = `🦅 AASGIER: ${player.name} haalt ${cardName} terug uit de weglegstapel!`;
                        console.log(`🦅 ${player.name} pakt ${cardName} uit discard pile`);
                    } else {
                        specialEffect = `🦅 AASGIER: Weglegstapel is leeg!`;
                    }
                    break;

                case 'GIRAFFE':
                    const topCards = this.deck.slice(-3).reverse();
                    if (topCards.length > 0) {
                        const cardNames = topCards.map(c => 
                            c.type === 'bigfive' ? c.animal : 
                            c.type === 'special' ? c.special : 'COMBO'
                        ).join(', ');
                        specialEffect = `🦒 GIRAFFE: Volgende ${topCards.length} kaart(en): ${cardNames}`;
                        console.log(`🦒 ${player.name} kijkt naar top ${topCards.length}: ${cardNames}`);
                    } else {
                        specialEffect = `🦒 GIRAFFE: Deck is leeg!`;
                    }
                    break;

                case 'IJSBEER':
                    opponent.frozen = true;
                    specialEffect = `🐻‍❄️ IJSBEER: ${opponent.name} wordt bevroren en slaat de volgende beurt over!`;
                    console.log(`🐻‍❄️ ${player.name} bevriest ${opponent.name}`);
                    break;

                case 'ZEBRA':
                    area.blocked = true;
                    area.blockedForPlayer = (playerIndex + 1) % 2;
                    specialEffect = `🦓 ZEBRA: Dit speelvlak is nu geblokkeerd voor ${opponent.name}! (+dubbele punten bij Big Five)`;
                    console.log(`🦓 ${player.name} blokkeert speelvlak ${targetAreaId + 1} voor ${opponent.name}`);
                    break;

                case 'KAMELEON':
                    specialEffect = `🦎 KAMELEON: Kan ontbrekend Big Five dier aanvullen (bij 4/5)`;
                    console.log(`🦎 ${player.name} speelt Kameleon`);
                    break;

                case 'BIG_FIVE_SPOTTER':
                    specialEffect = `🔭 BIG FIVE SPOTTER: Kan Big Five completeren bij 4 dieren`;
                    console.log(`🔭 ${player.name} speelt Big Five Spotter`);
                    break;
            }
        }

        // ZET OWNER EN PLAATS DE KAART
        card.owner = playerIndex;
        
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
            const newCard = this.deck.pop();
            player.hand.push(newCard);
            this.gameState.deckCount = this.deck.length;
        }

        this.gameState.lastPlayedCard = card;

        // Check voor complete Big Five set
        const bigFiveResult = this.checkForBigFive(targetAreaId, playerIndex);
        
        let bigFiveData = null;
        
        if (bigFiveResult.completed) {
            let points = 3;
            let bonusMessage = '';

            // ZEBRA BONUS: Dubbele punten als Zebra van deze speler in het speelvlak zit
            if (bigFiveResult.hasZebra) {
                points *= 2;
                bonusMessage = ' 🦓 (x2 door Zebra!)';
                console.log(`🦓 ZEBRA BONUS: Punten verdubbeld naar ${points}!`);
            }

            player.score += points;
            player.position = Math.min(player.score, 10);
            
            console.log(`🏆 ${player.name} heeft een Big Five set voltooid! +${points} punten${bonusMessage}`);
            
            // Sla alle kaarten op voor modal
            const allCards = [...area.cards, ...area.specialCards];
            
            bigFiveData = {
                playerName: player.name,
                cards: allCards,
                points: points,
                hasZebra: bigFiveResult.hasZebra
            };
            
            // Verwijder kaarten naar discard pile
            this.gameState.discardPile.push(...area.cards, ...area.specialCards);
            area.cards = [];
            area.specialCards = [];
            area.blocked = false;
            area.blockedForPlayer = null;

            const bigFiveEffect = `🏆 BIG FIVE COMPLEET! ${player.name} scoort ${points} punten${bonusMessage}`;
            
            if (specialEffect) {
                specialEffect = `${specialEffect}\n\n${bigFiveEffect}`;
            } else {
                specialEffect = bigFiveEffect;
            }
        }

        // Wissel beurt
        this.gameState.currentPlayer = (this.gameState.currentPlayer + 1) % 2;

        // Check winnaar
        this.checkWinner();

        return { 
            success: true, 
            bigFiveCompleted: bigFiveResult.completed,
            bigFiveData: bigFiveData,
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

        // Verzamel ALLE Big Five dieren in dit speelvlak (van beide spelers!)
        area.cards.forEach(card => {
            if (card.type === 'bigfive') {
                animals.add(card.animal);
            } else if (card.type === 'combination') {
                card.animals.forEach(a => animals.add(a));
            }
        });

        // Check speciale kaarten van DEZE SPELER (alleen eigen speciale kaarten tellen voor bonus)
        area.specialCards.forEach(card => {
            if (card.owner === playerIndex && card.type === 'special') {
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

        // KAMELEON of BIG FIVE SPOTTER van DEZE SPELER: vult ontbrekend dier aan (bij 4 van 5)
        if ((hasKameleon || hasBigFiveSpotter) && animals.size === 4) {
            const bigFive = ['LEEUW', 'OLIFANT', 'LUIPAARD', 'BUFFEL', 'NEUSHOORN'];
            const missing = bigFive.find(animal => !animals.has(animal));
            if (missing) {
                animals.add(missing);
                const cardType = hasKameleon ? 'Kameleon 🦎' : 'Big Five Spotter 🔭';
                console.log(`✨ ${cardType} van speler ${playerIndex} vult ontbrekend dier aan: ${missing}`);
            }
        }

        // Check voor COMPLETE Big Five (alle 5 dieren)
        const bigFive = ['LEEUW', 'OLIFANT', 'LUIPAARD', 'BUFFEL', 'NEUSHOORN'];
        const hasAllBigFive = bigFive.every(animal => animals.has(animal));
        
        // ALLEEN PUNTEN ALS BIG FIVE COMPLEET IS
        const completed = hasAllBigFive && area.cards.length > 0;

        if (completed) {
            console.log(`✅ Big Five compleet! Speler ${playerIndex} (${this.players[playerIndex].name}) wint de punten!`);
            console.log(`   Dieren in speelvlak: ${Array.from(animals).join(', ')}`);
        } else if (animals.size > 0) {
            console.log(`📊 Speelvlak ${areaId + 1} heeft ${animals.size}/5 dieren: ${Array.from(animals).join(', ')}`);
        }

        return { 
            completed, 
            hasZebra,
            animals: Array.from(animals),
            animalCount: animals.size
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
        
        state.players = this.players.map((p, idx) => ({
            name: p.name,
            score: p.score,
            position: p.position,
            handCount: p.hand.length,
            frozen: p.frozen,
            hand: p.id === playerId 
                ? p.hand 
                : p.hand.map(() => ({ hidden: true, imageNum: 55 }))
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

        if (game.startGame()) {
            console.log(`🎲 Spel gestart in room ${roomId}`);
            console.log(`📊 Deck bevat ${game.gameState.deckCount} kaarten`);
            
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
            const playerIndex = game.players.findIndex(p => p.id === socket.id);
            const player = game.players[playerIndex];
            console.log(`🃏 ${player.name} speelt kaart ${cardId} naar speelvlak ${targetAreaId + 1}`);
            
            if (result.specialEffect) {
                console.log(`✨ ${result.specialEffect}`);
            }

            if (result.bigFiveCompleted) {
                console.log(`🎯 ${player.name} heeft ${result.points} punten gescoord!`);
            }

            game.players.forEach((player) => {
                const playerSocket = io.sockets.sockets.get(player.id);
                if (playerSocket) {
                    const pIdx = game.players.findIndex(p => p.id === player.id);
                    playerSocket.emit('gameStateUpdated', {
                        gameState: game.getGameStateForPlayer(player.id),
                        yourPlayerId: pIdx,
                        specialEffect: result.specialEffect,
                        bigFiveData: result.bigFiveData
                    });
                }
            });

            if (game.gameState.winner !== null) {
                const winner = game.players[game.gameState.winner];
                console.log(`👑 ${winner.name} wint het spel met ${winner.score} punten!`);
            }
        } else if (result.skipTurn) {
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
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🦁 BIG FIVE - SAFARI KAARTSPEL SERVER`);
    console.log(`${'='.repeat(70)}`);
    console.log(`📡 Server draait op poort: ${PORT}`);
    console.log(`🌐 Local URL: http://localhost:${PORT}`);
    console.log(`${'='.repeat(70)}\n`);
    
    console.log(`✨ SPELREGELS:\n`);
    console.log(`📋 BIG FIVE SCORING:`);
    console.log(`   • ALLE kaarten in speelvlak tellen mee (van beide spelers)`);
    console.log(`   • Jouw 3 kaarten + tegenstander's 2 kaarten = JIJ wint!`);
    console.log(`   • Degene die 5e kaart legt krijgt de punten`);
    console.log(`   • Complete Big Five (5/5) = 3 punten`);
    console.log(`   • Incomplete sets = GEEN punten`);
    console.log(`   • Eerste naar 10 punten wint\n`);
    
    console.log(`🎴 SPECIALE KAARTEN:`);
    console.log(`   🦎 KAMELEON - Joker voor ontbrekend dier (bij 4/5)`);
    console.log(`   🦓 ZEBRA - Dubbele punten (3→6) + blokkeer voor tegenstander`);
    console.log(`   🐊 KROKODIL - Steel willekeurige kaart`);
    console.log(`   🦒 GIRAFFE - Bekijk top 3 kaarten`);
    console.log(`   🦅 AASGIER - Pak kaart uit weglegstapel`);
    console.log(`   🐻‍❄️ IJSBEER - Bevries tegenstander (skip beurt)`);
    console.log(`   🔭 BIG FIVE SPOTTER - Completeer bij 4 dieren\n`);
    
    console.log(`🔧 FIXES:`);
    console.log(`   ✅ Kaarten onderaan 160x224px - volledig leesbaar`);
    console.log(`   ✅ Horizontale scroll - geen overlap`);
    console.log(`   ✅ Win counter met localStorage tracking`);
    console.log(`   ✅ Game freeze fix na Big Five modal`);
    console.log(`   ✅ Kleinere deck/wegleggen vakken`);
    console.log(`   ✅ Compacte layout bovenaan\n`);
    
    console.log(`${'='.repeat(70)}\n`);
});
