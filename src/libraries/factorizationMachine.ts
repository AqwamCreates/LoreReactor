// src/libraries/factorizationMachine.ts
// Factorization Machines based on Rendle, S. (2010).
// "Factorization Machines". ICDM 2010.
// https://www.ismll.uni-hildesheim.de/pub/pdfs/Rendle2010FM.pdf

// ─────────────────────────────────────────────────────────────────────────────
// Vector
// ─────────────────────────────────────────────────────────────────────────────

export class Vector {
    private data: Float64Array;
    readonly length: number;

    constructor(length: number, fill: number = 0) {
        this.length = length;
        this.data = new Float64Array(length);
        if (fill !== 0) this.data.fill(fill);
    }

    static zeros(n: number): Vector { return new Vector(n, 0); }
    static ones(n: number): Vector { return new Vector(n, 1); }

    static random(n: number, scale: number = 0.01): Vector {
        const v = new Vector(n);
        for (let i = 0; i < n; i++) {
            v.data[i] = (Math.random() - 0.5) * scale;
        }
        return v;
    }

    static from(values: number[]): Vector {
        const v = new Vector(values.length);
        for (let i = 0; i < values.length; i++) v.data[i] = values[i];
        return v;
    }

    get(i: number): number { return this.data[i]; }
    set(i: number, v: number): void { this.data[i] = v; }
    add(i: number, v: number): void { this.data[i] += v; }

    clone(): Vector {
        const v = new Vector(this.length);
        v.data.set(this.data);
        return v;
    }

    toArray(): number[] { return Array.from(this.data); }

    dot(other: Vector): number {
        let sum = 0;
        for (let i = 0; i < this.length; i++) {
            sum += this.data[i] * other.data[i];
        }
        return sum;
    }

    norm(): number {
        let sum = 0;
        for (let i = 0; i < this.length; i++) {
            sum += this.data[i] * this.data[i];
        }
        return Math.sqrt(sum);
    }

    /** Grow to newSize, filling new entries with fillValue */
    grow(newSize: number, fillValue: number = 0): Vector {
        if (newSize <= this.length) return this;
        const v = new Vector(newSize, fillValue);
        v.data.set(this.data);
        return v;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Matrix
// ─────────────────────────────────────────────────────────────────────────────

export class Matrix {
    private data: Float64Array;
    readonly rows: number;
    readonly cols: number;

    constructor(rows: number, cols: number, fill: number = 0) {
        this.rows = rows;
        this.cols = cols;
        this.data = new Float64Array(rows * cols);
        if (fill !== 0) this.data.fill(fill);
    }

    static zeros(rows: number, cols: number): Matrix {
        return new Matrix(rows, cols, 0);
    }

    /**
     * Random init using the paper's recommendation (Section 5):
     * w ~ 0, V ~ N(0, sigma) where sigma is small (e.g., 0.01)
     */
    static random(rows: number, cols: number, mean: number = 0, sigma: number = 0.01): Matrix {
        const m = new Matrix(rows, cols);
        for (let i = 0; i < rows * cols; i++) {
            // Box-Muller transform for normal distribution
            const u1 = Math.random();
            const u2 = Math.random();
            const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
            m.data[i] = mean + sigma * z;
        }
        return m;
    }

    private idx(i: number, j: number): number {
        return i * this.cols + j;
    }

    get(i: number, j: number): number { return this.data[this.idx(i, j)]; }
    set(i: number, j: number, v: number): void { this.data[this.idx(i, j)] = v; }
    add(i: number, j: number, v: number): void { this.data[this.idx(i, j)] += v; }

    row(i: number): Vector {
        const v = new Vector(this.cols);
        const offset = i * this.cols;
        for (let j = 0; j < this.cols; j++) {
            v.set(j, this.data[offset + j]);
        }
        return v;
    }

    col(j: number): Vector {
        const v = new Vector(this.rows);
        for (let i = 0; i < this.rows; i++) {
            v.set(i, this.data[this.idx(i, j)]);
        }
        return v;
    }

    setRow(i: number, v: Vector): void {
        const offset = i * this.cols;
        for (let j = 0; j < this.cols; j++) {
            this.data[offset + j] = v.get(j);
        }
    }

    transpose(): Matrix {
        const t = new Matrix(this.cols, this.rows);
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < this.cols; j++) {
                t.data[j * t.cols + i] = this.data[this.idx(i, j)];
            }
        }
        return t;
    }

    /** Matrix-vector product: y = M·x */
    matvec(x: Vector): Vector {
        const y = new Vector(this.rows);
        for (let i = 0; i < this.rows; i++) {
            let sum = 0;
            const offset = i * this.cols;
            for (let j = 0; j < this.cols; j++) {
                sum += this.data[offset + j] * x.get(j);
            }
            y.set(i, sum);
        }
        return y;
    }

    clone(): Matrix {
        const m = new Matrix(this.rows, this.cols);
        m.data.set(this.data);
        return m;
    }

    toArray(): number[][] {
        const arr: number[][] = [];
        for (let i = 0; i < this.rows; i++) {
            const row: number[] = [];
            for (let j = 0; j < this.cols; j++) {
                row.push(this.data[this.idx(i, j)]);
            }
            arr.push(row);
        }
        return arr;
    }

    /**
     * Grow rows from current to newSize. New rows initialized with random values.
     * Used when feature dimensionality grows during online learning.
     */
    growRows(newRows: number, mean: number = 0, sigma: number = 0.01): Matrix {
        if (newRows <= this.rows) return this;
        const m = Matrix.random(newRows, this.cols, mean, sigma);
        // Copy old data row by row
        for (let i = 0; i < this.rows; i++) {
            for (let j = 0; j < this.cols; j++) {
                m.set(i, j, this.get(i, j));
            }
        }
        return m;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sparse Vector
// ─────────────────────────────────────────────────────────────────────────────

export interface SparseVector {
    indices: number[];
    values: number[];
}

export function sparseFromRecord(
    features: Record<string, number>,
    indexer: (name: string) => number,
): SparseVector {
    const indices: number[] = [];
    const values: number[] = [];
    for (const [name, value] of Object.entries(features)) {
        if (value !== 0) {
            indices.push(indexer(name));
            values.push(value);
        }
    }
    return { indices, values };
}

export function sparseToDense(x: SparseVector, length: number): Vector {
    const v = Vector.zeros(length);
    for (let i = 0; i < x.indices.length; i++) {
        v.set(x.indices[i], x.values[i]);
    }
    return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factorization Machine
// ─────────────────────────────────────────────────────────────────────────────

export interface FMConfig {
    /** k: dimensionality of latent factors (paper: Section 3) */
    numFactors: number;
    /** η: learning rate for SGD (paper: Algorithm 1) */
    learningRate: number;
    /** λ₀: L2 regularization for bias w₀ */
    regBias: number;
    /** λw: L2 regularization for linear weights w */
    regWeight: number;
    /** λv: L2 regularization for latent factors V */
    regLatent: number;
    /** Number of SGD epochs (paper: Algorithm 1) */
    epochs: number;
    /** σ: standard deviation for initializing V ~ N(0, σ) (paper: Section 5) */
    initLatentSigma: number;
    /** Task: regression (MSE) or classification (log loss) */
    task: 'regression' | 'classification';
    /** Mini-batch size for SGD */
    batchSize: number;
    verbose: boolean;
}

export interface FMSample {
    x: SparseVector;
    y: number;
    weight?: number;
}

export interface FMSerialized {
    config: FMConfig;
    w0: number;
    weightMatrix: number[];
    latentMatrix: number[][];
    numFeatures: number;
    featureMap: [string, number][];
}

/**
 * Factorization Machine (Rendle, 2010).
 *
 * Model equation (Equation 3):
 *   ŷ(x) = w₀ + Σᵢ wᵢxᵢ + Σᵢ Σⱼ>ᵢ <vᵢ, vⱼ> xᵢxⱼ
 *
 * Parameters:
 *   w₀ ∈ ℝ                         — global bias
 *   weightMatrix ∈ ℝⁿˣ¹            — linear weights (column vector w)
 *   latentMatrix ∈ ℝⁿˣᵏ            — latent factor matrix V
 *
 * Efficient interaction computation (Equation 5):
 *   Σᵢ Σⱼ>ᵢ <vᵢ, vⱼ> xᵢxⱼ = ½ Σf [(Σᵢ vᵢ,f xᵢ)² − Σᵢ (vᵢ,f xᵢ)²]
 *
 * SGD gradients (Equations 9–11):
 *   ∂ŷ/∂w₀    = 1
 *   ∂ŷ/∂wᵢ    = xᵢ
 *   ∂ŷ/∂vᵢ,f  = xᵢ · (Σⱼ vⱼ,f xⱼ − vᵢ,f xᵢ)
 */
export class FactorizationMachine {
    private w0: number = 0;
    private weightMatrix: Matrix;   // (numFeatures × 1) — linear weights w as column vector
    private latentMatrix: Matrix;   // (numFeatures × k) — latent factors V
    private numFeatures: number = 0;
    private config: FMConfig;
    private featureMap: Map<string, number> = new Map();
    private initialized: boolean = false;

    constructor(config: Partial<FMConfig> = {}) {
        this.config = {
            numFactors: config.numFactors ?? 8,
            learningRate: config.learningRate ?? 0.01,
            regBias: config.regBias ?? 0,
            regWeight: config.regWeight ?? 0.001,
            regLatent: config.regLatent ?? 0.001,
            epochs: config.epochs ?? 20,
            initLatentSigma: config.initLatentSigma ?? 0.01,
            task: config.task ?? 'classification',
            batchSize: config.batchSize ?? 1,
            verbose: config.verbose ?? false,
        };
        // Initialize with 0 features; grows dynamically
        this.weightMatrix = Matrix.zeros(0, 1);
        this.latentMatrix = Matrix.zeros(0, this.config.numFactors);
    }

    // ── Feature indexing ──────────────────────────────────────────────

    /**
     * Map a feature name to a numeric index.
     * Grows weightMatrix and latentMatrix if a new feature is introduced.
     */
    featureIndex(name: string): number {
        if (!this.featureMap.has(name)) {
            const idx = this.featureMap.size;
            this.featureMap.set(name, idx);
            this.ensureCapacity(idx + 1);
        }
        return this.featureMap.get(name)!;
    }

    private ensureCapacity(needed: number): void {
        if (needed <= this.numFeatures) return;
        // Doubling strategy to amortize reallocation
        const newSize = Math.max(needed, this.numFeatures * 2 || 32);

        // Grow weightMatrix from (old × 1) to (new × 1), new entries = 0
        this.weightMatrix = this.weightMatrix.growRows(newSize, 0, 0);

        // Grow latentMatrix from (old × k) to (new × k), new entries ~ N(0, σ)
        this.latentMatrix = this.latentMatrix.growRows(
            newSize, 0, this.config.initLatentSigma,
        );

        this.numFeatures = newSize;
        this.initialized = true;
    }

    /** Build a sparse feature vector from a Record<string, number> */
    buildSparseVector(features: Record<string, number>): SparseVector {
        return sparseFromRecord(features, name => this.featureIndex(name));
    }

    // ── Latent vectors ────────────────────────────────────────────────

    /**
     * Get the latent vector vᵢ for feature i (row i of V).
     */
    latentVector(featureIndex: number): Vector {
        if (featureIndex < 0 || featureIndex >= this.numFeatures) {
            throw new Error(`Feature index ${featureIndex} out of range [0, ${this.numFeatures})`);
        }
        return this.latentMatrix.row(featureIndex);
    }

    /**
     * Compute the dot product <vᵢ, vⱼ> between two feature latent vectors.
     */
    latentDot(i: number, j: number): number {
        return this.latentVector(i).dot(this.latentVector(j));
    }

    // ── Prediction ────────────────────────────────────────────────────

    /**
     * Raw prediction (before activation) for a single dense sample.
     * Implements Equation 3 + Equation 5 from Rendle (2010).
     */
    private predictRawDense(x: Vector): number {
        let result = this.w0;
        const n = x.length;
        const k = this.config.numFactors;

        // Linear term: Σᵢ wᵢ xᵢ
        for (let i = 0; i < n; i++) {
            const xi = x.get(i);
            if (xi === 0) continue;
            result += this.weightMatrix.get(i, 0) * xi;
        }

        // Interaction term using Equation 5:
        // ½ Σf [(Σᵢ vᵢ,f xᵢ)² − Σᵢ (vᵢ,f xᵢ)²]
        for (let f = 0; f < k; f++) {
            let sum = 0;
            let sumSq = 0;
            for (let i = 0; i < n; i++) {
                const xi = x.get(i);
                if (xi === 0) continue;
                const term = this.latentMatrix.get(i, f) * xi;
                sum += term;
                sumSq += term * term;
            }
            result += 0.5 * (sum * sum - sumSq);
        }

        return result;
    }

    /**
     * Raw prediction for a single sparse sample.
     * Only iterates over non-zero features — O(k·|x|) instead of O(k·n).
     */
    private predictRawSparse(x: SparseVector): number {
        let result = this.w0;
        const k = this.config.numFactors;

        // Linear term
        for (let idx = 0; idx < x.indices.length; idx++) {
            const i = x.indices[idx];
            result += this.weightMatrix.get(i, 0) * x.values[idx];
        }

        // Interaction term (Equation 5)
        for (let f = 0; f < k; f++) {
            let sum = 0;
            let sumSq = 0;
            for (let idx = 0; idx < x.indices.length; idx++) {
                const i = x.indices[idx];
                const term = this.latentMatrix.get(i, f) * x.values[idx];
                sum += term;
                sumSq += term * term;
            }
            result += 0.5 * (sum * sum - sumSq);
        }

        return result;
    }

    private activate(raw: number): number {
        if (this.config.task === 'classification') {
            // Clamp to avoid overflow in exp
            const clamped = Math.max(-500, Math.min(500, raw));
            return 1 / (1 + Math.exp(-clamped));
        }
        return raw;
    }

    /**
     * Predict labels for a batch of samples.
     *
     * @param featureMatrix (n_samples × n_features)
     * @returns labelVector (n_samples)
     */
    predict(featureMatrix: Matrix): Vector {
        const nSamples = featureMatrix.rows;
        const predictions = new Vector(nSamples);
        for (let s = 0; s < nSamples; s++) {
            const x = featureMatrix.row(s);
            const raw = this.predictRawDense(x);
            predictions.set(s, this.activate(raw));
        }
        return predictions;
    }

    /**
     * Predict for a single sparse sample.
     * Convenience for online inference.
     */
    predictOne(x: SparseVector): number {
        return this.activate(this.predictRawSparse(x));
    }

    /**
     * Predict for a batch of sparse samples.
     */
    predictSparse(samples: SparseVector[]): Vector {
        const predictions = new Vector(samples.length);
        for (let s = 0; s < samples.length; s++) {
            predictions.set(s, this.predictOne(samples[s]));
        }
        return predictions;
    }

    // ── Training ──────────────────────────────────────────────────────

    /**
     * Single-sample SGD step.
     * Implements Equations 9–11 from Rendle (2010), with L2 regularization.
     *
     * For regression (MSE loss ½(ŷ−y)²): gradient_multiplier = ŷ − y
     * For classification (log loss):     gradient_multiplier = σ(ŷ) − y
     */
    private sgdStep(x: SparseVector, y: number, lr: number, weight: number = 1): void {
        if (!this.initialized) {
            this.ensureCapacity(64);
        }

        const raw = this.predictRawSparse(x);
        const p = this.activate(raw);
        const err = (p - y) * weight;  // gradient multiplier
        const k = this.config.numFactors;

        // ── Update w₀ (Equation 9): ∂ŷ/∂w₀ = 1 ──
        this.w0 -= lr * (err + this.config.regBias * this.w0);

        // ── Precompute Σⱼ vⱼ,f xⱼ for each factor f ──
        // Needed for the V gradient (Equation 11).
        const sumVX = new Float64Array(k);
        for (let f = 0; f < k; f++) {
            let s = 0;
            for (let idx = 0; idx < x.indices.length; idx++) {
                const i = x.indices[idx];
                s += this.latentMatrix.get(i, f) * x.values[idx];
            }
            sumVX[f] = s;
        }

        // ── Update wᵢ and vᵢ,f for active features ──
        for (let idx = 0; idx < x.indices.length; idx++) {
            const i = x.indices[idx];
            const xi = x.values[idx];

            // Update wᵢ (Equation 10): ∂ŷ/∂wᵢ = xᵢ
            const wi = this.weightMatrix.get(i, 0);
            const gradW = err * xi + this.config.regWeight * wi;
            this.weightMatrix.set(i, 0, wi - lr * gradW);

            // Update vᵢ,f (Equation 11):
            //   ∂ŷ/∂vᵢ,f = xᵢ · (Σⱼ vⱼ,f xⱼ − vᵢ,f xᵢ)
            for (let f = 0; f < k; f++) {
                const vif = this.latentMatrix.get(i, f);
                const gradV = err * xi * (sumVX[f] - vif * xi)
                            + this.config.regLatent * vif;
                this.latentMatrix.set(i, f, vif - lr * gradV);
            }
        }
    }

    /**
     * Online learning: single-sample SGD update.
     * Convenience for incremental training after each observation.
     */
    trainOne(x: SparseVector, y: number, weight: number = 1): void {
        this.sgdStep(x, y, this.config.learningRate, weight);
    }

    /**
     * Batch training using SGD (Algorithm 1 from Rendle, 2010).
     *
     * @param featureMatrix (n_samples × n_features) — dense feature matrix
     * @param labelVector   (n_samples) — target labels
     */
    train(featureMatrix: Matrix, labelVector: Vector): void {
        const nSamples = featureMatrix.rows;
        if (nSamples === 0) return;
        if (featureMatrix.rows !== labelVector.length) {
            throw new Error(
                `Row count mismatch: featureMatrix has ${featureMatrix.rows} rows, ` +
                `labelVector has ${labelVector.length} entries`,
            );
        }

        // Ensure capacity for all features
        this.ensureCapacity(featureMatrix.cols);

        // Convert each row to a sparse vector for efficient SGD
        const samples: FMSample[] = [];
        for (let s = 0; s < nSamples; s++) {
            const row = featureMatrix.row(s);
            const indices: number[] = [];
            const values: number[] = [];
            for (let i = 0; i < row.length; i++) {
                const v = row.get(i);
                if (v !== 0) {
                    indices.push(i);
                    values.push(v);
                }
            }
            samples.push({ x: { indices, values }, y: labelVector.get(s) });
        }

        const { epochs, verbose, batchSize, learningRate } = this.config;

        for (let epoch = 0; epoch < epochs; epoch++) {
            // Shuffle
            for (let i = samples.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [samples[i], samples[j]] = [samples[j], samples[i]];
            }

            // Mini-batch SGD
            for (let i = 0; i < samples.length; i += batchSize) {
                const end = Math.min(i + batchSize, samples.length);
                for (let s = i; s < end; s++) {
                    this.sgdStep(samples[s].x, samples[s].y, learningRate);
                }
            }

            if (verbose && (epoch + 1) % Math.max(1, Math.floor(epochs / 10)) === 0) {
                const loss = this.computeLoss(featureMatrix, labelVector);
                console.log(`[FM] epoch ${epoch + 1}/${epochs}  loss=${loss.toFixed(4)}`);
            }
        }
    }

    /**
     * Train from a batch of sparse samples.
     */
    trainSparse(samples: FMSample[]): void {
        if (samples.length === 0) return;

        let maxIdx = 0;
        for (const s of samples) {
            for (const i of s.x.indices) {
                if (i > maxIdx) maxIdx = i;
            }
        }
        this.ensureCapacity(maxIdx + 1);

        const { epochs, verbose, batchSize, learningRate } = this.config;

        for (let epoch = 0; epoch < epochs; epoch++) {
            const shuffled = [...samples];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            for (let i = 0; i < shuffled.length; i += batchSize) {
                const end = Math.min(i + batchSize, shuffled.length);
                for (let s = i; s < end; s++) {
                    this.sgdStep(shuffled[s].x, shuffled[s].y, learningRate, shuffled[s].weight);
                }
            }

            if (verbose && (epoch + 1) % Math.max(1, Math.floor(epochs / 10)) === 0) {
                const xSparse = samples.map(s => s.x);
                const yVec = Vector.from(samples.map(s => s.y));
                const preds = this.predictSparse(xSparse);
                const loss = this.lossFromVectors(yVec, preds);
                console.log(`[FM] epoch ${epoch + 1}/${epochs}  loss=${loss.toFixed(4)}`);
            }
        }
    }

    // ── Loss ──────────────────────────────────────────────────────────

    private lossFromVectors(yTrue: Vector, yPred: Vector): number {
        const n = yTrue.length;
        let total = 0;
        const eps = 1e-15;

        if (this.config.task === 'classification') {
            // Binary cross-entropy
            for (let i = 0; i < n; i++) {
                const p = Math.max(eps, Math.min(1 - eps, yPred.get(i)));
                const y = yTrue.get(i);
                total -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
            }
        } else {
            // MSE
            for (let i = 0; i < n; i++) {
                const d = yPred.get(i) - yTrue.get(i);
                total += d * d;
            }
        }
        return total / n;
    }

    computeLoss(featureMatrix: Matrix, labelVector: Vector): number {
        const predictedLabelVector = this.predict(featureMatrix);
        return this.lossFromVectors(labelVector, predictedLabelVector);
    }

    // ── Introspection ─────────────────────────────────────────────────

    /** Feature importances: |wᵢ| + Σf |vᵢ,f| */
    featureImportance(): Map<string, number> {
        const imp = new Map<string, number>();
        for (const [name, idx] of this.featureMap.entries()) {
            let score = Math.abs(this.weightMatrix.get(idx, 0));
            for (let f = 0; f < this.config.numFactors; f++) {
                score += Math.abs(this.latentMatrix.get(idx, f));
            }
            imp.set(name, score);
        }
        return new Map([...imp.entries()].sort((a, b) => b[1] - a[1]));
    }

    /** All known feature names, in index order. */
    featureNames(): string[] {
        const names = new Array(this.featureMap.size);
        for (const [name, idx] of this.featureMap.entries()) {
            names[idx] = name;
        }
        return names;
    }

    /** Get the linear weight wᵢ for feature i */
    getWeight(featureIndex: number): number {
        return this.weightMatrix.get(featureIndex, 0);
    }

    /** Get the global bias w₀ */
    getBias(): number {
        return this.w0;
    }

    // ── Serialization ─────────────────────────────────────────────────

    toJSON(): FMSerialized {
        const n = this.featureMap.size;
        const weightArray: number[] = [];
        for (let i = 0; i < n; i++) {
            weightArray.push(this.weightMatrix.get(i, 0));
        }
        const latentArray: number[][] = [];
        for (let i = 0; i < n; i++) {
            const row: number[] = [];
            for (let f = 0; f < this.config.numFactors; f++) {
                row.push(this.latentMatrix.get(i, f));
            }
            latentArray.push(row);
        }
        return {
            config: { ...this.config },
            w0: this.w0,
            weightMatrix: weightArray,
            latentMatrix: latentArray,
            numFeatures: n,
            featureMap: Array.from(this.featureMap.entries()),
        };
    }

    static fromJSON(data: FMSerialized): FactorizationMachine {
        const fm = new FactorizationMachine(data.config);
        fm.w0 = data.w0;
        fm.featureMap = new Map(data.featureMap);
        fm.numFeatures = data.numFeatures;

        fm.weightMatrix = Matrix.zeros(data.numFeatures, 1);
        for (let i = 0; i < data.weightMatrix.length; i++) {
            fm.weightMatrix.set(i, 0, data.weightMatrix[i]);
        }

        fm.latentMatrix = Matrix.zeros(data.numFeatures, data.config.numFactors);
        for (let i = 0; i < data.latentMatrix.length; i++) {
            for (let f = 0; f < data.config.numFactors; f++) {
                fm.latentMatrix.set(i, f, data.latentMatrix[i][f]);
            }
        }
        fm.initialized = true;
        return fm;
    }

    /** Human-readable weight export */
    exportWeights(): {
        bias: number;
        weightMatrix: Record<string, number>;
        latentMatrix: Record<string, number[]>;
        featureCount: number;
    } {
        const w: Record<string, number> = {};
        const v: Record<string, number[]> = {};
        for (const [name, idx] of this.featureMap.entries()) {
            w[name] = this.weightMatrix.get(idx, 0);
            const row: number[] = [];
            for (let f = 0; f < this.config.numFactors; f++) {
                row.push(this.latentMatrix.get(idx, f));
            }
            v[name] = row;
        }
        return {
            bias: this.w0,
            weightMatrix: w,
            latentMatrix: v,
            featureCount: this.featureMap.size,
        };
    }
}