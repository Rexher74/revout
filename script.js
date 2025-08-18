// Classes

// Class by ChatGPT
class Ball {
    constructor(x, y, vx, vy, radius = 10) {
        this.x = x;
        this.y = y;
        this.vx = vx;
        this.vy = vy;
        this.radius = radius;
    }
    update(dt, game) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        // Use grid content bounds (excluding grid padding outside of cells)
        const g = game.geom;
        const left   = g.padLeft;
        const right  = g.padLeft + g.contentW;
        const top    = g.padTop;
        const bottom = g.padTop + g.contentH;

        // World bounds bounce
        if (this.x - this.radius < left || this.x + this.radius > right) {
            this.vx *= -1;
            this.x = clamp(this.x, left + this.radius, right - this.radius);
        }
        if (this.y - this.radius < top || this.y + this.radius > bottom) {
            this.vy *= -1;
            this.y = clamp(this.y, top + this.radius, bottom - this.radius);
        }

        // Structure collisions
        this.collided = game.checkBallStructureCollision(this);
    }
    draw(ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2);
        ctx.fillStyle = "white";
        ctx.fill();
        ctx.closePath();
    }
}

class Game {
    constructor(rows = 15, cols = 29, timePerLevel = 10, marketEvery = 5, baseWalls = 16,
        distanceToBuildFromEnemyKing = 6
    ) {
        this.rows = rows;
        this.cols = cols;
        this.distanceBuildEnemyKing = distanceToBuildFromEnemyKing;
        this.baseWalls = baseWalls;
        this.availableToBuild = undefined;
        this.marketEvery = marketEvery;
        this.timePerLevel = timePerLevel;
        this.targetPurchase = undefined;
        this.nplayers = undefined;
        this.marketTourn = -1;
        this.eventListenerMarketTimer = undefined;
        this.eliminatedPlayers = undefined;
        this.moneyPlayers = document.getElementsByClassName("moneySpan");
        this.level = 1
        this.gridElement = document.getElementById('grid');
        this.gridState = Array.from({ length: rows }, () =>
            Array.from({ length: cols }, () => null)
        );
        this.gridCells = [];

        this.renderGrid();

        this.canvas = document.getElementById("gameCanvas");
        this.ctx = this.canvas.getContext("2d");
        this.balls = [];
        this.lastTime = null;
        this.geom = { padLeft: 0, padTop: 0, gapX: 0, gapY: 0, cellW: 0, cellH: 0, contentW: 0, contentH: 0 };
        this.levelTimer = null;

        window.addEventListener("resize", () => this.updateCanvasBounds());
        window.addEventListener("scroll", () => this.updateCanvasBounds(), { passive: true });
        this.updateCanvasBounds();
    }

    checkBallStructureCollision(ball) {
        const g = this.geom;
        const colCenter = Math.floor((ball.x - g.padLeft) / (g.cellW + g.gapX));
        const rowCenter = Math.floor((ball.y - g.padTop)  / (g.cellH + g.gapY));

        for (let r = rowCenter - 1; r <= rowCenter + 1; r++) {
            if (r < 0 || r >= this.rows) continue;
            for (let c = colCenter - 1; c <= colCenter + 1; c++) {
                if (c < 0 || c >= this.cols) continue;
                const structure = this.gridState[r][c];
                if (!(structure instanceof Structure)) continue;

                // Inflate the rectangle by 1 pixel on each side
                let rect = this.getCellRect(r, c);
                const closestX = clamp(ball.x, rect.x, rect.x + rect.w);
                const closestY = clamp(ball.y, rect.y, rect.y + rect.h);
                let dx = ball.x - closestX;
                let dy = ball.y - closestY;
                let dist2 = dx*dx + dy*dy;
                if (dist2 <= ball.radius * ball.radius) {
                    // Compute collision normal
                    let nx, ny;
                    if (dx === 0 && dy === 0) {
                        const dl = Math.abs(ball.x - rect.x);
                        const dr = Math.abs((rect.x + rect.w) - ball.x);
                        const dtp = Math.abs(ball.y - rect.y);
                        const db = Math.abs((rect.y + rect.h) - ball.y);
                        const m = Math.min(dl, dr, dtp, db);
                        if (m === dl) { nx = -1; ny = 0; ball.x = rect.x - ball.radius; }
                        else if (m === dr) { nx = 1; ny = 0; ball.x = rect.x + rect.w + ball.radius; }
                        else if (m === dtp) { nx = 0; ny = -1; ball.y = rect.y - ball.radius; }
                        else { nx = 0; ny = 1; ball.y = rect.y + rect.h + ball.radius; }
                    } else {
                        const dist = Math.sqrt(dist2) || 0.0001;
                        nx = dx / dist; ny = dy / dist;
                        const penetration = ball.radius - dist;
                        ball.x += nx * penetration;
                        ball.y += ny * penetration;
                    }
                    const dot = ball.vx * nx + ball.vy * ny;
                    ball.vx -= 2 * dot * nx;
                    ball.vy -= 2 * dot * ny;

                    // Differentiate structure types
                    if (structure instanceof Wall) {
                        if (structure.reduceLives()) {
                            this.gridState[r][c] = null;
                            const cell = this.gridCells[r][c];
                            cell.classList.remove("cellWall");
                            cell.style.backgroundColor = "";
                            cell.innerHTML = "";
                        } else {
                            const cell = this.gridCells[r][c];
                            const livesDiv = cell.querySelector("div");
                            if (livesDiv) livesDiv.textContent = structure.lives;
                        }
                    } else if (structure instanceof King && !this.isProtectedByAdjacentStructures(r, c)) {
                        this.gridState[r][c] = null;
                        const cell = this.gridCells[r][c];
                        cell.style.backgroundColor = "";
                        cell.innerHTML = "";
                        this.eliminatePlayer(structure.color);
                    } else if (structure instanceof BaseWall) {
                        // Nothing to do here
                    } else if (structure instanceof RegeWall) {
                        if (structure.reduceLives()) {
                            this.gridState[r][c] = null;
                            const cell = this.gridCells[r][c];
                            cell.classList.remove("cellWall", "regeWallStyle");
                            cell.style.backgroundColor = "";
                            cell.innerHTML = "";
                        } else {
                            const cell = this.gridCells[r][c];
                            const livesDiv = cell.querySelector("div");
                            if (livesDiv) livesDiv.textContent = structure.lives;
                        }
                    } else if (structure instanceof Bank && !this.isProtectedByAdjacentStructures(r, c)) {
                        // Banks allways has 1 life
                        this.gridState[r][c] = null;
                        const cell = this.gridCells[r][c];
                        cell.classList.remove("cellWall");
                        cell.style.backgroundColor = "";
                        cell.innerHTML = "";
                    }

                    return true;
                }
            }
        }
        return false;
    }

    // Returns true if the cell at (r, c) is protected by an adjacent (orthogonal) structure
    isProtectedByAdjacentStructures(r, c) {
        // Check top
        if (r > 0 && this.gridState[r-1][c] == null) return false;
        // Check bottom
        if (r < this.rows-1 && this.gridState[r+1][c] == null) return false;
        // Check left
        if (c > 0 && this.gridState[r][c-1] == null) return false;
        // Check right
        if (c < this.cols-1 && this.gridState[r][c+1] == null) return false;
        
        return true;
    }
    

    generateBaseWalls(numBW) {
        let num = numBW;
        // Helper to place a base wall if not present
        const tryPlaceBaseWall = (row, col) => {
            if (
                row >= 0 && row < this.rows &&
                col >= 0 && col < this.cols &&
                this.gridState[row][col] == null
            ) {
                this.gridState[row][col] = new BaseWall();
                let cell = this.gridCells[row][col];
                cell.style.backgroundColor = CODE_PLAYERS[this.marketTourn];
                cell.classList.add("cellBaseWall");
                return true;
            }
            return false;
        };

        if (this.nplayers === 1) {
            // Original behavior
            for (let i = 0; i < num; ++i) {
                let done = false;
                while (!done) {
                    let col = getRandomInt(this.cols - 2) + 1;
                    let row = getRandomInt(this.rows - 2) + 1;
                    if (tryPlaceBaseWall(row, col)) {
                        done = true;
                    }
                }
            }
        } else if (this.nplayers === 2) {
            num /= 2;
            // Place in left half and mirror to right half
            let placed = 0;
            let maxCol = Math.floor(this.cols / 2) - 1;
            while (placed < num) {
                let col = getRandomInt(maxCol - 1) + 1; // avoid border
                let row = getRandomInt(this.rows - 2) + 1;
                let mirrorCol = this.cols - 1 - col;
                // Place on left half
                if (tryPlaceBaseWall(row, col)) {
                    // Mirror to right half
                    if (col !== mirrorCol) {
                        tryPlaceBaseWall(row, mirrorCol);
                    }
                    placed++;
                }
            }
        } else if (this.nplayers === 4) {
            // Place in top-left quadrant and mirror to other quadrants
            num /= 4;
            let placed = 0;
            let maxRow = Math.floor(this.rows / 2) - 1;
            let maxCol = Math.floor(this.cols / 2) - 1;
            while (placed < num) {
                let row = getRandomInt(maxRow - 1) + 1;
                let col = getRandomInt(maxCol - 1) + 1;
                let positions = [
                    [row, col],
                    [row, this.cols - 1 - col],
                    [this.rows - 1 - row, col],
                    [this.rows - 1 - row, this.cols - 1 - col]
                ];
                // Only place if all positions are empty
                let canPlaceAll = positions.every(([r, c]) =>
                    r >= 0 && r < this.rows && c >= 0 && c < this.cols && this.gridState[r][c] == null
                );
                if (canPlaceAll) {
                    for (let [r, c] of positions) {
                        tryPlaceBaseWall(r, c);
                    }
                    placed++;
                }
            }
        }
    }

    endGame() {
        let playersToBe;
        if (this.nplayers == 1) playersToBe = 0;
        else playersToBe = 1;
        let playersAlive = 0;
        for (let i = 0; i < this.eliminatedPlayers.length; ++i) {
            if (this.eliminatedPlayers[i] == 0) ++playersAlive;
        }
        return playersAlive == playersToBe;
    }

    eliminatePlayer(color) {
        this.eliminatedPlayers[COLOR_TO_PLAYER[color]] = 1;
        console.log(this.moneyPlayers)
        console.log(COLOR_TO_PLAYER[color])
        console.log(color)
        this.moneyPlayers[COLOR_TO_PLAYER[color]].textContent = "-";
        if (this.endGame()) {
            this.stopGame();
            this.setEndGame();
        }
    }

    stopGame() {
        this.balls = [];
        clearTimeout(this.levelTimer);
        clearInterval(this.eventListenerMarketTimer);
    }

    setEndGame() {
        endGameDiv.style.display = "flex";
        if (this.nplayers == 1) winnerDiv.textContent = `You Reached Level ${this.level}!`;
        else {
            let winner;
            for (let i = 0; i < this.eliminatedPlayers.length; ++i) {
                if (this.eliminatedPlayers[i] == 0) winner = CODE_PLAYERS[i];
            }
            winnerDiv.textContent = `The winner is ${winner}!`;
        }
    }

    updateCanvasBounds() {
        const rect = this.gridElement.getBoundingClientRect();
        // Position canvas exactly over the grid in viewport coordinates
        this.canvas.style.left = rect.left + "px";
        this.canvas.style.top  = rect.top + "px";
        this.canvas.width  = Math.round(rect.width);
        this.canvas.height = Math.round(rect.height);
        this.computeGridMetrics();
    }

    computeGridMetrics() {
        const styles = getComputedStyle(this.gridElement);
        const padLeft = parseFloat(styles.paddingLeft) || 0;
        const padRight = parseFloat(styles.paddingRight) || 0;
        const padTop = parseFloat(styles.paddingTop) || 0;
        const padBottom = parseFloat(styles.paddingBottom) || 0;
        const gapX = parseFloat(styles.columnGap || styles.gap) || 0;
        const gapY = parseFloat(styles.rowGap || styles.gap) || 0;

        const clientW = this.gridElement.clientWidth;  // includes padding
        const clientH = this.gridElement.clientHeight; // includes padding
        const contentW = clientW - padLeft - padRight;
        const contentH = clientH - padTop - padBottom;

        const cellW = (contentW - gapX * (this.cols - 1)) / this.cols;
        const cellH = (contentH - gapY * (this.rows - 1)) / this.rows;

        this.geom = { padLeft, padTop, gapX, gapY, cellW, cellH, contentW, contentH };
    }

    getCellRect(r, c) {
        const g = this.geom;
        const x = g.padLeft + c * (g.cellW + g.gapX);
        const y = g.padTop  + r * (g.cellH + g.gapY);
        return { x, y, w: g.cellW, h: g.cellH };
    }

    renderGrid() {
        this.gridElement.innerHTML = ''; // limpiar si ya existe
        for (let r = 0; r < this.rows; r++) {
            let rowCells = []
            for (let c = 0; c < this.cols; c++) {
                const cell = document.createElement('div');
                cell.classList.add('cell');
                cell.dataset.row = r;
                cell.dataset.col = c;

                rowCells.push(cell);

                cell.addEventListener('click', () => this.cellClicked(r, c, cell));

                this.gridElement.appendChild(cell);

                if ((this.rows-1)/2 == r && (this.cols-1)/2 == c) {
                    cell.classList.add("spawnerCell")
                }
            }
            this.gridCells.push(rowCells)
        }
    }

    cellClicked(r, c, cell) {
        if (this.targetPurchase) {
            let livesElement = parseInt(this.targetPurchase.dataset.lives);
            let priceElement = parseInt(this.targetPurchase.dataset.price);
            let typeStructure = this.targetPurchase.dataset.type;
            let currentMoneyPlayer = parseInt(this.moneyPlayers[this.marketTourn].textContent);
            if (currentMoneyPlayer >= priceElement && (this.gridState[r][c] == null || this.gridState[r][c].color == CODE_PLAYERS[this.marketTourn])) {
                if (this.noNearEnemy(r, c, CODE_PLAYERS[this.marketTourn])) {
                    if (typeStructure == "wall") {
                        this.gridState[r][c] = new Wall(livesElement, CODE_PLAYERS[this.marketTourn]);
                        cell.style.backgroundColor = CODE_PLAYERS[this.marketTourn];
                        cell.classList.add("cellWall");
                        cell.innerHTML = `<div>${livesElement}</div>`;
                    }
                    else if (typeStructure == "regewall") {
                        let regeLives = parseInt(this.targetPurchase.dataset.rege);
                        this.gridState[r][c] = new RegeWall(livesElement, CODE_PLAYERS[this.marketTourn], regeLives, cell);
                        cell.style.backgroundColor = CODE_PLAYERS[this.marketTourn];
                        cell.classList.add("cellWall", "regeWallStyle");
                        cell.innerHTML = `<div>${livesElement}</div><span class="infoDownStructure">+${regeLives}</span>`;
                    }
                    else if (typeStructure == "bank") {
                        let moneyPerTourn = parseInt(this.targetPurchase.dataset.moneypertourn);
                        this.gridState[r][c] = new Bank(CODE_PLAYERS[this.marketTourn], moneyPerTourn);
                        cell.style.backgroundColor = CODE_PLAYERS[this.marketTourn];
                        cell.classList.add("cellWall");
                        cell.innerHTML = `<div><span class="material-symbols-outlined iconStructure">account_balance</span></div><span class="infoDownStructureCenter">+${moneyPerTourn}€</span>`;
                    }
                    this.moneyPlayers[this.marketTourn].textContent = `${currentMoneyPlayer-priceElement}€`;
                }
            }
        }
    }

    noNearEnemy(r, c, ownColor) {
        return this.availableToBuild[r][c] == "free" || this.availableToBuild[r][c] == ownColor;
    }

    getState() {
        return this.gridState;
    }

    iniPlayers(n) {
        this.nplayers = parseInt(n);
        this.eliminatedPlayers = Array.from({length: this.nplayers}, () => 0);
        
        if (this.nplayers == 1) {
            this.gridState[0][0] = new King(1, CODE_PLAYERS[0])

            this.gridCells[0][0].style.backgroundColor = CODE_PLAYERS[0];

            this.gridCells[0][0].classList.add("cellKing");
        }
        else if (this.nplayers == 2) {
            this.gridState[(this.rows-1)/2][0] = new King(1, CODE_PLAYERS[0]);
            this.gridState[(this.rows-1)/2][this.cols-1] = new King(1, CODE_PLAYERS[1]);

            this.gridCells[(this.rows-1)/2][0].style.backgroundColor = CODE_PLAYERS[0];
            this.gridCells[(this.rows-1)/2][this.cols-1].style.backgroundColor = CODE_PLAYERS[1];

            this.gridCells[(this.rows-1)/2][0].classList.add("cellKing");
            this.gridCells[(this.rows-1)/2][this.cols-1].classList.add("cellKing");
        }
        else if (this.nplayers == 4) {
            this.gridState[0][0] = new King(1, CODE_PLAYERS[0]);
            this.gridState[this.rows-1][0] = new King(1, CODE_PLAYERS[1]);
            this.gridState[0][this.cols-1] = new King(1, CODE_PLAYERS[2]);
            this.gridState[this.rows-1][this.cols-1] = new King(1, CODE_PLAYERS[3]);

            this.gridCells[0][0].style.backgroundColor = CODE_PLAYERS[0];
            this.gridCells[this.rows-1][0].style.backgroundColor = CODE_PLAYERS[1];
            this.gridCells[0][this.cols-1].style.backgroundColor = CODE_PLAYERS[2];
            this.gridCells[this.rows-1][this.cols-1].style.backgroundColor = CODE_PLAYERS[3];

            this.gridCells[0][0].classList.add("cellKing");
            this.gridCells[this.rows-1][0].classList.add("cellKing");
            this.gridCells[0][this.cols-1].classList.add("cellKing");
            this.gridCells[this.rows-1][this.cols-1].classList.add("cellKing");
        }
        else alert("Invalid number of players");
        this.generateBaseWalls(this.baseWalls);
        this.generateAvailableToBuild();
        present("Market Time", () => this.startMarket());
    }

    markAvailable(r, c, color) {
        for (let rr = 0; rr < this.rows; ++rr) {
            for (let cc = 0; cc < this.cols; ++cc) {
                if (Math.abs(rr - r) + Math.abs(cc - c) <= this.distanceBuildEnemyKing) {
                    this.availableToBuild[rr][cc] = color;
                }
            }
        }
    }

    generateAvailableToBuild() {
        this.availableToBuild = Array.from({ length: this.rows }, () =>
            Array.from({ length: this.cols }, () => "free")
        );
        
        if (this.nplayers == 1) {
            return;
        }
        else if (this.nplayers == 2) {
            // Two kings: blue at (center row, 0), red at (center row, cols-1)
            const row = (this.rows - 1) / 2;
            this.markAvailable.call(this, row, 0, CODE_PLAYERS[0]);
            this.markAvailable.call(this, row, this.cols - 1, CODE_PLAYERS[1]);
        }
        else if (this.nplayers == 4) {
            // Four kings: blue (0,0), red (rows-1,0), green (0,cols-1), goldenrod (rows-1,cols-1)
            this.markAvailable.call(this, 0, 0, CODE_PLAYERS[0]);
            this.markAvailable.call(this, this.rows - 1, 0, CODE_PLAYERS[1]);
            this.markAvailable.call(this, 0, this.cols - 1, CODE_PLAYERS[2]);
            this.markAvailable.call(this, this.rows - 1, this.cols - 1, CODE_PLAYERS[3]);
        }
    }

    makeLevelActions() {
        console.log("MakeActions");
        for (let r = 0; r < this.rows; ++r) {
            for (let c = 0; c < this.cols; ++c) {
                let structure = this.gridState[r][c];
                if (structure != null) structure.makeAction();
            }
        }
    }

    startMarket() {
        console.log("MarketStarted")
        for (let i = this.nplayers; i < 4; ++i) {
            this.moneyPlayers[i].textContent = "-";
        }
        market.style.display = "flex";
        this.marketTourn = -1; // Set to -1 to start at 0 at this.nextMarketTourn()
        this.nextMarketTourn();
    }

    nextMarketTourn() {
        ++this.marketTourn;
        if (this.marketTourn == this.nplayers) {
            this.endMarket();
        }
        else {
            if (this.marketTourn != 0) {
                this.moneyPlayers[this.marketTourn-1].parentNode.style.color = "rgb(195, 195, 195)";
                this.moneyPlayers[this.marketTourn-1].parentNode.style.fontWeight = "300";
                for (let i = 0; i < elementPurchaseIcons.length; ++i) elementPurchaseIcons[i].classList.remove(`bck-${CODE_PLAYERS[this.marketTourn-1]}`);
            };
            if (this.eliminatedPlayers[this.marketTourn]) this.nextMarketTourn();
            else {
                this.moneyPlayers[this.marketTourn].parentNode.style.color = "white";
                this.moneyPlayers[this.marketTourn].parentNode.style.fontWeight = "900";
                playerTourn.style.backgroundColor = CODE_PLAYERS[this.marketTourn];
                for (let i = 0; i < elementPurchaseIcons.length; ++i) elementPurchaseIcons[i].classList.add(`bck-${CODE_PLAYERS[this.marketTourn]}`);
                if (this.targetPurchase) this.targetPurchase.classList.remove("itemSelected");
                this.targetPurchase = undefined;
                this.resetAndSetTimer();
            }
        }
    }

    resetAndSetTimer() {
        timerMarket.textContent = "60s";
        clearInterval(this.eventListenerMarketTimer);
        this.eventListenerMarketTimer = setInterval(function() {
            let remainingTime = parseInt(timerMarket.textContent);
            if (remainingTime == 0) {
                game.nextMarketTourn();
            }
            else {
                timerMarket.textContent = `${remainingTime-1}s`
            }
        }, 1000);
    }

    endMarket() {
        clearInterval(this.eventListenerMarketTimer);
        this.moneyPlayers[this.marketTourn-1].parentNode.style.color = "rgb(195, 195, 195)";
        this.moneyPlayers[this.marketTourn-1].parentNode.style.fontWeight = "300";
        for (let i = 0; i < elementPurchaseIcons.length; ++i) elementPurchaseIcons[i].classList.remove(`bck-${CODE_PLAYERS[this.marketTourn-1]}`);
        this.marketTourn = -1;
        if (this.targetPurchase) this.targetPurchase.classList.remove("itemSelected");
        this.targetPurchase = undefined;
        playerTourn.style.backgroundColor = "white";
        present(`Level ${this.level}`, () => this.nextLevel());
    }

    selectItemToPurchase(t) {
        if (this.targetPurchase) this.targetPurchase.classList.remove("itemSelected");
        this.targetPurchase = t;
        this.targetPurchase.classList.add("itemSelected");
    }

    nextLevel(levelBalls = null) {
        let balls;
        if (levelBalls == null) balls = 1000+(this.level-1)*5;
        else balls = levelBalls;
        clearTimeout(this.levelTimer);
        this.balls = [];
        let startX = this.canvas.width / 2;
        let startY = this.canvas.height / 2;
        for (let i = 0; i < balls; i++) {
            let angle = Math.random() * 2 * Math.PI;
            let speed = 500;
            let vx = Math.cos(angle) * speed;
            let vy = Math.sin(angle) * speed;
            this.balls.push(new Ball(startX, startY, vx, vy));
        }
        // Tiempo de cada nivel (15 segundos)
        timerMarket.textContent = `${this.timePerLevel}s`;
        clearInterval(this.eventListenerMarketTimer);

        let remainingTime = this.timePerLevel;
        this.eventListenerMarketTimer = setInterval(() => {
            remainingTime--;
            timerMarket.textContent = `${remainingTime}s`;
            if (remainingTime <= 0) {
                clearInterval(this.eventListenerMarketTimer);
                this.endLevel();
            }
        }, 1000);
    }

    startGameLoop() {
        this.lastTime = performance.now();
        const loop = (ts) => {
            let dt = (ts - this.lastTime) / 1000;
            this.lastTime = ts;
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            for (let ball of this.balls) {
                ball.update(dt, this);
                ball.draw(this.ctx);
            }
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    /*addMoney() {
        for (let i = 0; i < this.moneyPlayers.length; ++i) {
            let moneyP = parseInt(this.moneyPlayers[i].textContent);
            if (!isNaN(moneyP)) {
                moneyP += 100;
                this.moneyPlayers[i].textContent = `${moneyP}€`;
            }
        }
    }*/

    endLevel() {
        this.balls = [];
        this.level++;
        this.makeLevelActions();
        if ((this.level-1)%this.marketEvery == 0) present("Market Time", () => this.startMarket());
        else present(`Level ${this.level}`, () => this.nextLevel());
    }

    gameLoop(ts) {
        let dt = (ts - this.lastTime) / 1000;
        this.lastTime = ts;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        for (let ball of this.balls) {
            ball.update(dt, this);
            ball.draw(this.ctx);
        }
        requestAnimationFrame((ts) => this.gameLoop(ts));
    }
}

class Structure {
    constructor(lives) {
        this.lives = lives
    }
    reduceLives(amount = 1) {
        this.lives -= amount;
        return this.lives == 0
    }
    makeAction() {
        return;
    }
}

class King extends Structure {
    constructor(lives, color) {
        super(lives)
        this.color = color;
    }

    // Add 25€ to player
    makeAction() {
        let moneyP = parseInt(game.moneyPlayers[COLOR_TO_PLAYER[this.color]].textContent);
        if (!isNaN(moneyP)) {
            moneyP += 25;
            game.moneyPlayers[COLOR_TO_PLAYER[this.color]].textContent = `${moneyP}€`;
        }
    }
}

class Wall extends Structure {
    constructor(lives, color) {
        super(lives)
        this.color = color;
    }
}

class RegeWall extends Structure {
    constructor(lives, color, regeTourn, cell) {
        super(lives);
        this.color = color;
        this.regeTourn = regeTourn;
        this.cell = cell;
    }
    rege() {
        this.lives += this.regeTourn;
    }

    // Regenerate Live
    makeAction() {
        this.rege();
        const livesDiv = this.cell.querySelector("div");
        if (livesDiv) livesDiv.textContent = this.lives;
    }
}

class BaseWall extends Structure {
    constructor() {
        super(-1); // Vidas infinitas
        this.color = "none";
    }
}

class Bank extends Structure {
    constructor(color, moneyPerTourn) {
        super(1); // Vidas infinitas
        this.color = color;
        this.moneyPerTourn = moneyPerTourn;
    }


    // Inc. money
    makeAction() {
        let moneyP = parseInt(game.moneyPlayers[COLOR_TO_PLAYER[this.color]].textContent);
        if (!isNaN(moneyP)) {
            moneyP += this.moneyPerTourn;
            game.moneyPlayers[COLOR_TO_PLAYER[this.color]].textContent = `${moneyP}€`;
        }
    }
}

// Constants

const CODE_PLAYERS = ["blue", "red", "green", "goldenrod"]
const COLOR_TO_PLAYER = {"blue": 0, "red": 1, "green": 2, "goldenrod": 3};

// Variables
var playButton = document.getElementById("playButton")
var selectNumPlayers = document.getElementById("selectNumPlayers")
var optionsPlayersToPlay = document.getElementsByClassName("clickablePlayers")
var market = document.getElementById("market");
var playerTourn = document.getElementById("playerTourn");
var timerMarket = document.getElementById("timerMarket");
var elementPurchaseIcons = document.getElementsByClassName("elementIcon");
var elementsStore = document.getElementsByClassName("elementToPurchase");
var winnerDiv = document.getElementById("winnerDiv");
var endGameDiv = document.getElementById("endGameDiv");

// Functions

// Utilities

function getRandomInt(max) {
    return Math.floor(Math.random() * max);
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Game development

function iniEventListeners() {
    playButton.addEventListener("click", gameStarted)
    
    for (let i = 0; i < optionsPlayersToPlay.length; ++i) {
        optionsPlayersToPlay[i].addEventListener("click", function() {
            selectNumPlayers.style.display = "none"
            game.iniPlayers(optionsPlayersToPlay[i].textContent);
        })
    }

    playerTourn.addEventListener("click", function() {
        if (game.marketTourn != -1) game.nextMarketTourn();
    })

    for (let i = 0; i < elementsStore.length; ++i) {
        elementsStore[i].addEventListener("click", function(e) {
            if (game.marketTourn != -1) game.selectItemToPurchase(e.currentTarget);
        })
    }
}

function gameStarted() {
    playButton.style.display = "none";
    selectNumPlayers.style.display = "flex";
}

function present(title, callback = null) {
    const introDiv = document.getElementById("introDiv");
    const titleIntro = document.getElementById("titleIntro");

    titleIntro.textContent = title;
    introDiv.style.display = "flex";

    // Creamos una función con nombre que gestiona todo
    const handleAnimationEnd = (event) => {
        // La propia función se encarga de eliminarse
        event.currentTarget.removeEventListener("animationend", handleAnimationEnd);

        // Oculta el elemento
        event.currentTarget.style.display = "none";
        
        // Ejecuta el callback
        if (callback) {
            callback();
        }
    };

    // Añadimos el event listener usando la referencia a la función
    introDiv.addEventListener("animationend", handleAnimationEnd);
}

// Inicializar el juego
const game = new Game();
game.startGameLoop();
iniEventListeners();