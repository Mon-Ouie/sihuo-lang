import { h, render, Component } from "preact";
import GoBoard from "@sabaki/go-board";
import { BoundedGoban } from "@sabaki/shudan";
import SGF from "@sabaki/sgf";

/**
 * Converts a string with coordinates from an SGF file (e.g. ac) to a 2-element
 * array with indices of the point it refers to.
 */
function coordsToVertex(coords) {
    const offset = 'a'.charCodeAt(0);
    return [coords.charCodeAt(0) - offset, coords.charCodeAt(1) - offset];
}

function vertexToCoords(vertex) {
    const VERTEX_NAME = "abcdefghijklmnopqrstuvwxyz";
    return VERTEX_NAME[vertex[0]] + VERTEX_NAME[vertex[1]];
}

function sameVertex([x1, y1], [x2, y2]) {
    return x1 == x2 && y1 == y2;
}

/**
 * Visits a game tree and returns the smallest rectangle that contains all
 * points that it refers to.
 *
 * Instead of using this, we may want to preprocess the puzzles and use the SGF tag VW.
 */
function coordsRange(game) {
    const boardSize = game.data["SZ"] ? parseInt(game.data["SZ"]) : 19;

    let minX = boardSize - 1, minY = boardSize - 1;
    let maxX = 0, maxY = 0;

    function visitVertex([x, y]) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }

    function visitNode(node) {
        if (node.data["B"]) visitVertex(coordsToVertex(node.data["B"][0]));
        if (node.data["W"]) visitVertex(coordsToVertex(node.data["W"][0]));
        if (node.data["AW"])
            game.data["AW"].forEach(coords => visitVertex(coordsToVertex(coords)));
        if (node.data["AB"])
            game.data["AB"].forEach(coords => visitVertex(coordsToVertex(coords)));

        if (node.data["CR"])
            node.data["CR"].forEach(coords => visitVertex(coordsToVertex(coords)));

        if (node.data["MA"])
            node.data["MA"].forEach(coords => visitVertex(coordsToVertex(coords)));

        if (node.data["SQ"])
            node.data["SQ"].forEach(coords => visitVertex(coordsToVertex(coords)));

        if (node.data["TR"])
            node.data["TR"].forEach(coords => visitVertex(coordsToVertex(coords)));

        if (node.data["LB"])
            node.data["LB"].forEach(entry => visitVertex(coordsToVertex(entry.split(':')[0])));

        node.children.forEach(visitNode);
    }

    visitNode(game);

    return [minX, minY, maxX, maxY];
}

function addMarks(markerMap, coords, type) {
    if (coords) {
        coords.forEach((v) => {
            let [x, y] = coordsToVertex(v);
            markerMap[y][x] = {type: type};
        });
    }
}

/** Returns the largest id of any node within the tree (including the root) */
function maxNodeId(tree) {
    return tree.children.reduce((id, x) => Math.max(id, maxNodeId(x)), tree.id);
}

async function loadSGF(path) {
    const response = await fetch(path);
    const sgf = await response.text();

    /*
     * Firefox complains that the application is slowing down the browser when
     * doing this with large files, maybe do this somewhere else.
     *
     * Maybe this should be done in a different context (also maybe the
     * application should have a server so the client doesn't need to download
     * the entire puzzle database if it gets large).
     */
    const games = SGF.parse(sgf);

    return games;
}

/**
 * Selects the same number of puzzles from each rank.
 *
 *
 * Ranks of the puzzles are indicated by the `BR` SGF tag.
 *
 * This probably should avoid picking duplicate puzzles, but currently does not.
 */
function selectPuzzles(games) {
    const puzzlesPerRank = 5;

    function compareRank(a, b) {
        if (a.includes("D") && b.includes("K"))
            return 1;
        else if (a.includes("K") && b.includes("D"))
            return -1;
        else if (a.includes("K"))
            return parseInt(b) - parseInt(a);
        else
            return parseInt(a) - parseInt(b);
    }

    const seenRanks = {};
    const ranks = [];

    const puzzlesByRank = {};
    games.forEach(game => {
        let rank = game.data["BR"][0];
        if (rank && rank[rank.length - 1] == "+")
            rank = rank.slice(0, rank.length - 1);

        if (!seenRanks[rank]) {
            seenRanks[rank] = true,
            ranks.push(rank);
        }

        if (!puzzlesByRank[rank])
            puzzlesByRank[rank] = [game];
        else
            puzzlesByRank[rank].push(game);
    });

    const puzzles = [];

    ranks.sort(compareRank).forEach(rank => {
        const source = puzzlesByRank[rank];

        for (let i = 0; i < puzzlesPerRank; i++) {
            let puzzle;
            /* Awkward way to filter some puzzle categories from 101weiqi */
            do {
                puzzle = source[Math.floor(Math.random() * source.length)];
            } while (puzzle.data["GC"] &&
                     puzzle.data["GC"][0] &&
                     puzzle.data["GC"][0].includes("落子题"));

            puzzles.push(puzzle);
        }
    });

    return puzzles;
}

/** Start time of each run in seconds */
const DURATION = 180;

const COMBO_LEVELS = [5, 12, 20, 30]; /* Required  combo to get bonus time */
const COMBO_BONUS = [3, 5, 7, 10]; /* Bonus in seconds */

const PLACE_STONE_SOUND = new Audio("audio/tick.webm");
const CAPTURE_SOUND = new Audio("audio/capture-1-pile.webm");

const WRONG_SOUND = new Audio("audio/wrong.ogg");
const GOOD_SOUND = new Audio("audio/good.ogg");

function playMoveSound(board, sign, vertex) {
    /*
     * Is there a nice way to figure out how many stones were captured and play
     * a different sound for just one ston vs. capturing many stones?
     */
    const { capturing } = board.analyzeMove(sign, vertex);
    if (capturing) CAPTURE_SOUND.play();
    else PLACE_STONE_SOUND.play();
}

let puzzles;
async function loadPuzzles() {
    if (!puzzles)
        puzzles = await loadSGF("puzzles.sgf");

    return puzzles;
}

/**
 * Replaces linebreaks with br HTML elements.
 */
function formatText(text) {
    const elements = [];
    const lines = text.split("\n");
    lines.forEach((line, i) => {
        elements.push(h("span", {}, [line]));
        if (i + 1 < lines.length) elements.push(h("br", {}, []));
    });

    return elements;
}

class SihuoLang extends Component {
    constructor(props) {
        super(props);

        this.state = {
            /* Timestamp when the clock started */
            startTime: null,

            /* Total amount of bonus seconds accrued over the run */
            bonusTime: 0,

            /* How much time is left for the run in seconds */
            time: DURATION,

            /* Number of puzzles the player got right*/
            score: 0,

            /* Number of consecutive */
            combo: 0,

            /* Highest value combo ever reached */
            maxCombo: 0,

            /* Number of correct moves that were played */
            numRights: 0,

            /* Number of mistakes */
            numWrongs: 0,

            /* Coordinates of the last vertex that was moused over */
            hoveredVertex: null,

            /* Set to true after the end of the run to show stats and review the solution to the puzzles */
            review: false,

            /*
             * Index of the puzzle currently being displayed
             * (start at -1 so that we can increment it by one to load the first puzzle).
             */
            puzzleId: -1,

            /* GoBoard instance containing */
            board: null,

            /* Amount of seconds given as bonus (or malus if negative) to the player */
            displayedBonus: null,

            /*
             * For each puzzle solved so far, the time it took to solve it and
             * whether or not the answer was correct.
             */
            puzzleHistory: [],

            /* For post-run review, the total number of seconds the run took. */
            totalTime: null,

            /* SGF node of the current board state */
            currentNode: null,

            /* Rectangle that should be to the viewer */
            minX: 0, minY: 0, maxX: 18, maxY: 18,

            /* For review, the parents of the currentNode (allowing us to backtrack) */
            history: [],

            /* Timestamp when the current puzzle started */
            puzzleStart: null,

            /* Array containing the puzzles for the current run */
            puzzles: [],

            /* Highest node id in the puzzle so far (for adding new nodes in the review) */
            nodeId: 0,
        };

        this.startRun();
    }

    /* Load the puzzles and starts a run asynchronously. */
    startRun() {
        loadPuzzles().then(games => {
            this.setState({
                startTime: null,
                bonusTime: 0,
                time: DURATION,
                score: 0,
                combo: 0, maxCombo: 0,
                numRights: 0, numWrongs: 0,
                hoveredVertex: null,
                review: false,
                puzzleId: -1,
                displayedBonus: null,
                puzzleHistory: [],
                puzzles: selectPuzzles(games),
                board: null,
            }, () => this.loadNextPuzzle());
        });
    }

    /*
     * Starts automatically updating the amount of remaining time and ending the
     * run when time runs out.
     */
    startClock() {
        const updateTimer = (timestamp) => {
            if (this.state.review)
                return;

            if (!this.state.startTime) {
                this.setState({ startTime: timestamp, time: DURATION });
                requestAnimationFrame(updateTimer);
                return;
            }

            const elapsed = (timestamp - this.state.startTime) / 1000;
            const remaining = Math.max(0, DURATION + this.state.bonusTime - elapsed);

            this.setState({ time: remaining });
            if (remaining > 0)
                requestAnimationFrame(updateTimer);
            else {
                this.failPuzzle();
                this.setState({ review: true, totalTime: elapsed });
            }
        };

        requestAnimationFrame(updateTimer);
    }

    /*
     * Creates a GoBoard from the root of an SGF tree, including setup stones.
     *
     * Also returns the rectangle corresponding to the part of the board that
     * should be shown.
     */
    boardForPuzzle(puzzle) {
        const boardSize = puzzle.data["SZ"] ? parseInt(puzzle.data["SZ"]) : 19;
        const board = GoBoard.fromDimensions(boardSize);

        const initialWhite = puzzle.data["AW"] || [];
        const initialBlack = puzzle.data["AB"] || [];

        initialWhite.forEach(coords => board.set(coordsToVertex(coords), -1));
        initialBlack.forEach(coords => board.set(coordsToVertex(coords), +1));

        let [minX, minY, maxX, maxY] = coordsRange(puzzle);
        minX = Math.max(0, minX - 1);
        minY = Math.max(0, minY - 1);

        maxX = Math.min(boardSize - 1, maxX + 1);
        maxY = Math.min(boardSize - 1, maxY + 1);

        return {
            board, minX, minY, maxX, maxY
        };
    }

    /** Loads a specific puzzle, given by its index in state.puzzles */
    loadPuzzle(puzzleId) {
        const puzzle = this.state.puzzles[puzzleId];

        const { board, minX, minY, maxX, maxY } =
            this.boardForPuzzle(puzzle);

        const isWhite = puzzle.data["PL"] && puzzle.data["PL"][0] == "W";

        this.setState({
            board,
            currentNode: puzzle,
            minX, minY, maxX, maxY,
            turn: isWhite ? "W" : "B",
            history: [],
            hoveredVertex: null,
            puzzleId,
            puzzleStart: performance.now(),
            nodeId: maxNodeId(puzzle),
        });
    }

    /**
     * Starts the next puzzle, or ends the run if the last one was reached.
     */
    loadNextPuzzle() {
        const puzzleId = this.state.puzzleId + 1;

        if (puzzleId >= this.state.puzzles.length) {
            const totalTime = (performance.now() - this.state.startTime) / 1000;
            this.setState({review: true, totalTime });
            return;
        }

        this.loadPuzzle(puzzleId);
    }

    /** Gives a time bonus (or malus if time is negative) and starts displaying it */
    giveBonus(time) {
        this.setState({bonusTime: this.state.bonusTime + time, displayedBonus: time});
        setTimeout(() => {
            this.setState({ displayedBonus: null });
        }, 1000);
    }

    /** Registers whether the current puzzle was passed or fail */
    storePuzzleState(passed) {
        this.state.puzzleHistory[this.state.puzzleId] = {
            time: (performance.now() - this.state.puzzleStart) / 1000,
            passed
        };
    }

    /**
     * Marks the current puzzle as incorrect and loads the next one.
     */
    failPuzzle() {
        this.storePuzzleState(false);
        this.setState({combo: 0, puzzleHistory: this.state.puzzleHistory});
        this.giveBonus(-10);
        this.loadNextPuzzle();
    }

    /**
     * Marks the current puzzle as correct and loads the next one.
     */
    passPuzzle() {
        this.storePuzzleState(true);
        this.setState({score: this.state.score + 1});
        this.loadNextPuzzle();
    }

    /** Triggers events that should happen everytime a correct move is played */
    onGoodMove() {
        this.setState({
            combo: this.state.combo + 1,
            maxCombo: Math.max(this.state.combo + 1, this.state.maxCombo),
            numRights: this.state.numRights + 1
        });
        const i = COMBO_LEVELS.findIndex(i => i == this.state.combo + 1);
        if (i != -1) {
            this.giveBonus(COMBO_BONUS[i]);
            GOOD_SOUND.play();
        }
        else if (this.state.combo + 1 > COMBO_LEVELS[COMBO_LEVELS.length - 1] &&
                 this.state.combo % 10 == 0) {
            this.giveBonus(COMBO_BONUS[COMBO_BONUS.length - 1]);
            GOOD_SOUND.play();
        }
    }

    /* Adds a new child to an SGF element */
    addNode(parent) {
        const child = {
            id: this.state.nodeId + 1,
            parentId: parent.id,
            children: [],
            data: {}
        };

        parent.children.push(child);
        this.setState({nodeId: this.state.nodeId + 1});

        return child;
    }

    /** Moves one move back in the puzzle history */
    back() {
        if (this.state.history.length == 0) return;
        const { board, node, turn } = this.state.history.pop();
        this.setState({ history: this.state.history, board, currentNode: node, turn });
    }

    /**
     * Moves one move forward along the main line of the puzzle (first child in the SGF subtree)
     */
    forward() {
        const nextNode = this.state.currentNode.children[0];
        if (!nextNode) return;

        const sign = nextNode.data["W"] ? -1 : 1;
        const vertex = nextNode.data["W"] ? coordsToVertex(nextNode.data["W"][0]) :
            coordsToVertex(nextNode.data["B"][0]);

        playMoveSound(this.state.board, sign, vertex);
        let newBoard = this.state.board.makeMove(sign, vertex);

        this.state.history.push({
            board: this.state.board,
            turn: this.state.turn,
            node: this.state.currentNode,
        });

        this.setState({
            board: newBoard,
            currentNode: nextNode,
            turn: sign == -1 ? 'B' : 'W',
            history: this.state.history
        });
    }

    render() {
        const elements = [];

        if (this.state.board)
            elements.push(this.renderBoard());

        elements.push(this.renderDashboard());

        const top = h("div", { class: "storm" }, elements);

        if (!this.state.review)
            return top;

        /* Use a button rather than a link to the puzzle page */
        const again = h("div", { class: "play-again" },
            h("button", { onClick: () => this.startRun() }, "Play Again!"));

        return h("div", { class: "storm-review" },
            [top,
                this.renderRunStats(),
                again,
                this.renderPuzzleHistory()]);
    }

    /** Renders the actual interactive board */
    renderBoard() {
        const board = this.state.board;
        const signMap = board.signMap.map(r => r.slice());

        let dimmedVertices = [];
        if (this.state.hoveredVertex) {
            const [x, y] = this.state.hoveredVertex;
            if (!signMap[y][x]) {
                signMap[y][x] = this.state.turn == 'W' ? -1 : 1;
                dimmedVertices = [this.state.hoveredVertex];
            }
        }

        const markerMap = new Array(this.state.board.height).fill().map(_ =>
            new Array(this.state.board.width).fill(null));
        addMarks(markerMap, this.state.currentNode.data.CR, "circle");
        addMarks(markerMap, this.state.currentNode.data.MA, "cross");
        addMarks(markerMap, this.state.currentNode.data.SQ, "square");
        addMarks(markerMap, this.state.currentNode.data.TR, "triangle");

        if (this.state.currentNode.data.LB) {
            this.state.currentNode.data.LB.forEach((entry) => {
                let [v, label] = entry.split(':');
                let [x, y] = coordsToVertex(v);
                markerMap[y][x] = { type: "label", label };
            });
        }

        const ghostStoneMap = new Array(this.state.board.height).fill().map(_ =>
            new Array(this.state.board.width).fill(null));

        if (this.state.review) {
            this.state.currentNode.children.forEach(node => {
                let vertex = null;
                let sign = null;
                if (node.data['B']) {
                    vertex = coordsToVertex(node.data['B'][0]);
                    sign = 1;
                }
                else if (node.data['W']) {
                    vertex = coordsToVertex(node.data['W'][0]);
                    sign = -1;
                }

                if (!vertex)
                    return;

                if (vertex[1] >= this.state.board.height || vertex[1] < 0 ||
                    vertex[0] >= this.state.board.width || vertex[0] < 0)
                    return;

                let type = null;
                if (node.data['TE']) type = 'good';
                else if (node.data['BM']) type = 'bad';
                else if (node.data['IT']) type = 'interesting';
                else if (node.data['DO']) type = 'doubtful';

                ghostStoneMap[vertex[1]][vertex[0]] = { sign, type };
            });
        }

        const boardElement = h(BoundedGoban, {
            maxWidth: window.innerWidth * 0.7,
            maxHeight: window.innerHeight - 50 - 100,
            rangeX: [this.state.minX, this.state.maxX],
            rangeY: [this.state.minY, this.state.maxY],
            showCoordinates: true,
            signMap, dimmedVertices, ghostStoneMap,
            markerMap,

            onVertexClick: (_evt, vertex) => {
                if (this.state.board.signMap[vertex[1]][vertex[0]] != 0) {
                    return;
                }

                let node = this.state.currentNode.children.find(child => {
                    return (this.state.review || !child.data["BM"]) &&
                        ((child.data["W"] && sameVertex(coordsToVertex(child.data["W"][0]), vertex)) ||
                            (child.data["B"] && sameVertex(coordsToVertex(child.data["B"][0]), vertex)));
                });

                if (!this.state.startTime) this.startClock();

                if (!this.state.review && !node) {
                    this.setState({ numWrongs: this.state.numWrongs + 1 });
                    WRONG_SOUND.play();
                    this.failPuzzle();
                    return;
                }

                if (!node) {
                    node = this.addNode(this.state.currentNode);
                    node.data[this.state.turn] = [vertexToCoords(vertex)];
                }

                this.state.history.push({
                    board: this.state.board,
                    turn: this.state.turn,
                    node: this.state.currentNode,
                });

                let sign = node.data["W"] ? -1 : 1;

                playMoveSound(this.state.board, sign, vertex);
                let newBoard = this.state.board.makeMove(sign, vertex);
                if (!this.state.review) this.onGoodMove();

                const nextNode = !this.state.review && node.children[0];
                if (nextNode) {
                    this.state.history.push({
                        board: newBoard,
                        turn: sign == -1 ? 'B' : 'W',
                        node,
                    });

                    sign = nextNode.data["W"] ? -1 : 1;
                    vertex = nextNode.data["W"] ? coordsToVertex(nextNode.data["W"][0]) : coordsToVertex(nextNode.data["B"][0]);
                    playMoveSound(newBoard, sign, vertex);
                    newBoard = newBoard.makeMove(sign, vertex);
                }

                this.setState({
                    board: newBoard,
                    currentNode: nextNode || node,
                    turn: sign == -1 ? 'B' : 'W'
                });

                if (!this.state.review && (!nextNode || nextNode.children.length == 0)) {
                    this.passPuzzle();
                }
            },

            onVertexPointerEnter: (_evt, vertex) => {
                this.setState({ hoveredVertex: vertex });
            },

            onVertexPointerLeave: (_evt, vertex) => {
                if (this.state.hoveredVertex &&
                    sameVertex(this.state.hoveredVertex, vertex))
                    this.setState({ hoveredVertex: null });
            }
        });

        const puzzle = this.state.puzzles[this.state.puzzleId];

        if (puzzle && puzzle.data["GC"][0]) {
            const title = puzzle.data["GC"][0].split("\n")[0];
            return (h("div", { class: "board" }, [h("h1", {}, title), boardElement]));
        }
        else
            return boardElement;
    }

    /**
     * Renders the dashboard with the clock or (during review) buttons to go
     * back/forward.
     */
    renderDashboard() {
        const root = this.state.puzzles && this.state.puzzles[this.state.puzzleId];
        let comment = null;
        if (this.state.currentNode &&
            this.state.currentNode.data["C"] &&
            this.state.currentNode.data["C"][0])
            comment = h("div", { class: "comment" },
                formatText(this.state.currentNode.data["C"][0]));
        else if (root && root.data["GC"] && root.data["GC"][0]) {
            comment = h("div", { class: "comment" }, formatText(root.data["GC"][0]));
        }

        if (this.state.review) {
            return h("div", { class: "dashboard" },
                [comment,
                    h("div", { class: "history-buttons" },
                        [h("button", { class: "back", onClick: () => this.back() }, ["⬅"]),
                        h("button", { class: "forward", onClick: () => this.forward() }, ["⮕"])])]);
        }
        else {
            const min = Math.floor(this.state.time / 60);
            const sec = Math.floor((this.state.time % 60)).toString().padStart(2, "0");

            let bonus = null, bonusClass = "";
            if (this.state.displayedBonus) {
                if (this.state.displayedBonus > 0) {
                    bonus = h('div', { class: "clock-bonus" }, `+${this.state.displayedBonus}`);
                    bonusClass = "clock-indicate-bonus";
                }
                else {
                    bonus = h('div', { class: "clock-malus" }, this.state.displayedBonus.toString());
                    bonusClass = "clock-indicate-malus";
                }
            }

            return h("div", { class: "dashboard" },
                [h("div", { class: "score" }, [this.state.score.toString()]),
                h("div", { class: `clock ${bonusClass}` }, [`${min}:${sec}`, bonus]),
                    comment,
                this.renderCombo()]);
        }
    }

    /** Displays the combo bar and how many */
    renderCombo() {
        const level = COMBO_LEVELS.findIndex(i => i > this.state.combo);
        let value, max;
        if (level == -1) {
            value = this.state.combo % 10;
            max = 10;
        }
        else {
            const prevLevelCombo = level == 0 ? 0 : COMBO_LEVELS[level - 1];
            value = this.state.combo - prevLevelCombo;
            max = COMBO_LEVELS[level] - prevLevelCombo;
        }

        let bonusClass = "";
        if (this.state.displayedBonus < 0 && value == 0)
            bonusClass = "progress-malus";
        else if (this.state.displayedBonus > 0)
            bonusClass = "progress-bonus";

        const style = {};
        style.width = `${Math.round((value / max) * 100)}%`;
        const val = h("div", {class: `progress-value ${bonusClass}`, style});

        const levelElements = COMBO_LEVELS.map((x, i) => {
            const active = this.state.combo >= x ? "combo-level-active" : "combo-level";
            const bonus = COMBO_BONUS[i];
            return h("div", {class: `combo-level combo-level-${i} ${active}`}, [`${bonus}s`]);
        });

        let bonusFull = null;
        if (this.state.displayedBonus > 0)
            bonusFull = h("div", {class: "progress-bonus-full"}, []);

        return h("div", {class: "combo"},
                 [h("div", {class: "combo-counter"},
                    h("span", {class: "combo-counter-value"}, [this.state.combo.toString()]),
                    h("span", {class: "combo-counter-indicator"}, ["COMBO"])),
                  h("div", {class: "combo-bars"},
                    [h("div", {class: `progress`}, [val, bonusFull]),
                     h("div", {class: "combo-levels"}, levelElements)])]);
    }

    renderPuzzleHistory() {
        return h("div", {class: "puzzle-history"},
                 [this.state.puzzleHistory.map((_, i) => this.renderPuzzleInfo(i))]);
    }

    /** Displays whether or not a puzzle was passed, and a button to go back and review it. */
    renderPuzzleInfo(i) {
        const { board, minX, minY, maxX, maxY } =
              this.boardForPuzzle(this.state.puzzles[i]);

        const { time, passed } = this.state.puzzleHistory[i];

        const boardElement = h(BoundedGoban, {
            signMap: board.signMap,
            maxWidth: 128,
            maxHeight: 128,
            rangeX: [minX, maxX],
            rangeY: [minY, maxY]
        });

        const formattedTime = time.toFixed(2);
        const rank = this.state.puzzles[i].data["WR"][0] || "?";

        const passClass = passed ? "puzzle-passed" : "puzzle-failed";

        const status = h("div", {class: "puzzle-status"},
                         [h("div", {class: `puzzle-time ${passClass}`}, [`${formattedTime}s`]),
                          h("div", {class: "puzzle-rank"}, [rank])]);

        return h("div", {
            class: "puzzle-info",
            onClick: () => this.loadPuzzle(i)
        }, [boardElement, status]);
    }

    /** Displays stats about the entire run */
    renderRunStats() {
        function asNumber(n) { return h("span", {class: "number"}, n); }

        const numMoves = this.state.numRights + this.state.numWrongs;
        const accuracy = numMoves == 0 ? 1 : this.state.numRights / numMoves;
        const accuracyPercent = (accuracy * 100).toFixed(1);
        const time = Math.round(this.state.totalTime);
        const timePerMove = (this.state.totalTime / numMoves).toFixed(2);

        const highestSolvedId = this.state.puzzleHistory.findLastIndex(hist => hist.passed);
        const highestSolved = highestSolvedId != -1 && this.state.puzzles[highestSolvedId];
        const highestSolvedRank = highestSolved && highestSolved.data["WR"] && highestSolved.data["WR"][0] ?
              highestSolved.data["WR"][0] : "-";

        const match = highestSolvedRank.match(/(\d+)(.+)/);
        let displayedRank;
        if (match)
            displayedRank = [asNumber(match[1]), match[2]];
        else
            displayedRank = asNumber(highestSolvedRank);

        const statsTable =
            h("table", { class: "run-stats" },
                h("tbody", {},
                    [h("tr", {}, h("th", {}, "Moves"), h("td", {}, asNumber(numMoves))),
                    h("tr", {}, h("th", {}, "Accuracy"), h("td", {}, [asNumber(accuracyPercent), "%"])),
                    h("tr", {}, h("th", {}, "Combo"), h("td", {}, asNumber(this.state.maxCombo))),
                    h("tr", {}, h("th", {}, "Time"), h("td", {}, [asNumber(time), "s"])),
                    h("tr", {}, h("th", {}, "Time per move"), h("td", {}, [asNumber(timePerMove), "s"])),
                    h("tr", {}, h("th", {}, "Highest solved"), h("td", {}, displayedRank))]));

        const score =
              h("div", { class: "post-game-score" },
                [h("div", { class: "post-game-score-value"}, this.state.score),
                 h("div", { class: "post-game-score-indicator"}, "Score")]);

        return h("div", {class: "run-stats"}, [score, statsTable]);
    }
}

render(h(SihuoLang), document.querySelector("#root"));
