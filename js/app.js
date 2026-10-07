const firebaseConfig = {
    apiKey: "AIzaSyD88L-rRngFVPswYg57xbvjMB5a9rlS3Vc",
    authDomain: "smartcart-2a1bc.firebaseapp.com",
    projectId: "smartcart-2a1bc",
    storageBucket: "smartcart-2a1bc.firebasestorage.app",
    messagingSenderId: "497766650452",
    appId: "1:497766650452:web:472748009ed09dce0cd3c1"
};

const app = window.initializeApp(firebaseConfig);
const auth = window.getAuth(app);
const db = window.getFirestore(app);

const BASE_SERVINGS = 4;
const DEFAULT_WEEKLY_BUDGET = 40;
let weeklyBudgetTarget = DEFAULT_WEEKLY_BUDGET;
const CATEGORY_ORDER = ["Produce", "Pantry", "Dairy", "Protein", "Other"];
const CATEGORY_ICON = { Produce: "🌿", Pantry: "🫙", Dairy: "🥛", Protein: "🍗", Other: "🛒" };
const CATEGORY_BG = { Produce: "#eaf0e4", Pantry: "#ffe9d1", Dairy: "#e3edf7", Protein: "#fff1c9", Other: "#f0ece2" };
const THUMB_BG = ["#ffe0da", "#eaf0e4", "#fff1c9", "#e3edf7", "#f3e3f5"];
const DEFAULT_STORE = "Target";

let currentUser = null;
let currentFilters = { mealType: "Lunch", budget: 12, priceBasis: "serving", diets: [], allergies: [], store: DEFAULT_STORE };
let currentMatches = [];
let currentActiveRecipe = null;
let currentServings = BASE_SERVINGS;
let currentList = [];
let lastMainTab = "view-wizard";
let preferredStore = DEFAULT_STORE;

// Reads Gemini's SSE stream and returns the full response text. Calls onObject with each
// top-level object of the streamed JSON array as soon as its closing brace arrives.
const readGeminiStream = async (res, onObject) => {
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let sseBuffer = '';
    let text = '';
    let scanned = 0, depth = 0, inString = false, escaped = false, objectStart = -1;

    const scanText = () => {
        for (; scanned < text.length; scanned++) {
            const ch = text[scanned];
            if (inString) {
                if (escaped) escaped = false;
                else if (ch === '\\') escaped = true;
                else if (ch === '"') inString = false;
            } else if (ch === '"') {
                inString = true;
            } else if (ch === '{' || ch === '[') {
                if (ch === '{' && depth === 1) objectStart = scanned;
                depth++;
            } else if (ch === '}' || ch === ']') {
                depth--;
                if (ch === '}' && depth === 1 && objectStart >= 0) {
                    try { onObject(JSON.parse(text.slice(objectStart, scanned + 1))); } catch { /* final parse will surface errors */ }
                    objectStart = -1;
                }
            }
        }
    };

    const handleEvent = (line) => {
        if (!line.startsWith('data:')) return;
        const chunk = JSON.parse(line.slice(5));
        if (chunk.error) throw new Error(chunk.error.message || 'Gemini stream error');
        for (const part of chunk.candidates?.[0]?.content?.parts || []) {
            if (part.text) text += part.text;
        }
        scanText();
    };

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        sseBuffer += value;
        const lines = sseBuffer.split(/\r?\n/);
        sseBuffer = lines.pop();
        lines.forEach(handleEvent);
    }
    handleEvent(sseBuffer.trim());
    return text;
};

const RecipeService = {
    async fetchRecipesFromLLM(filters) {
        const safeAllergies = filters.allergies.length ? filters.allergies.join(", ") : "None";
        const safeDiets = filters.diets.length ? filters.diets.join(", ") : "None";
        const budgetRule = filters.priceBasis === "store"
            ? `Each recipe's "totalCostInStore" MUST be less than or equal to $${filters.budget}, the user's maximum upfront store price.`
            : `Each recipe's "costPerServing" MUST be less than or equal to $${filters.budget}, the user's maximum budget per serving.`;

        const prompt = `
        Give me 6 affordable ${filters.mealType} recipes.

        CRITICAL RULES FOR GROCERY MATH:
        The user is shopping at ${filters.store}. You MUST estimate ingredient prices and package sizes based on typical inventory and pricing at ${filters.store}.
		${budgetRule}

        You must strictly differentiate between recipe quantities and store quantities:
        1. "quantityInStore" & "costInStore": The smallest realistic unit a person can buy at a standard grocery store and its full price (e.g., "1 bottle (16oz)", 4.99).
        2. "quantityInRecipe" & "costInRecipe": The exact amount used in the recipe (at 4 servings), and the mathematical prorated cost of that amount (e.g., "1 tbsp (0.5oz)", 0.15).
        3. Do NOT assume the user has any pantry staples. Everything must be bought.
        4. Assign each ingredient a "category" of exactly one of: Produce, Pantry, Dairy, Protein, Other.
        5. Provide a short 2-4 sentence "instructions" field describing how to cook the recipe.

        STRICT DIETARY RESTRICTIONS:
        - Allergies to avoid completely: ${safeAllergies}
        - Dietary preferences to follow: ${safeDiets}

        For "imageKeyword", give the common English name of the underlying dish exactly as it would be titled
        on Wikipedia, used to find a photo of it (e.g., "Fajita", "Chana masala", "Shakshouka", "Fried rice", "Chili con carne").
        Leave out brand names, cooking vessels, and minor variations (e.g., "Turkey chili" -> "Chili con carne").
        `;

        try {
            // The Gemini key lives server-side; see functions/api/generate.js
            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                systemInstruction: { parts: [{ text:
                    "You are a budget-conscious culinary expert designing grocery lists for college students. " +
                    "Your primary goal is to minimize out-of-pocket grocery store costs. " +
                    "You are a master at calculating prorated ingredient costs versus upfront store prices." }] },
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.2,
                    responseSchema: {
                        type: "ARRAY",
                        items: {
                            type: "OBJECT",
                            properties: {
                                name: { type: "STRING" },
                                time: { type: "STRING" },
                                costPerServing: { type: "NUMBER" },
                                totalCostInStore: { type: "NUMBER" },
                                imageKeyword: { type: "STRING" },
                                instructions: { type: "STRING" },
                                ingredients: {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            name: { type: "STRING" },
                                            quantityInRecipe: { type: "STRING" },
                                            costInRecipe: { type: "NUMBER" },
                                            quantityInStore: { type: "STRING" },
                                            costInStore: { type: "NUMBER" },
                                        },
                                        required: ["name", "quantityInRecipe", "costInRecipe", "quantityInStore", "costInStore"]
                                    }
                                }
                            },
                            required: ["name", "time", "costPerServing", "totalCostInStore", "ingredients", "imageKeyword"]
                        }
                    }
                }
                })
            });
            if (!res.ok) throw new Error(`Recipe request failed (${res.status})`);
            // Start each recipe's photo lookup as soon as its JSON object is complete,
            // instead of waiting for all 6 recipes to finish generating.
            const text = await readGeminiStream(res, (recipe) => prefetchRecipeImage(recipe));
            return JSON.parse(text);
        } catch (error) {
            console.error("Error fetching from Gemini:", error);
            throw error;
        }
    }
};

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

const computeMatchPercent = (costPerServing, budget) => {
    if (!budget) return 90;
    const diff = Math.abs(costPerServing - budget) / budget;
    const pct = Math.round(98 - diff * 40);
    return Math.max(60, Math.min(99, pct));
};

const RECIPE_IMAGE_FALLBACK = 'https://images.unsplash.com/photo-1495521821757-a1efb6729352?auto=format&fit=crop&w=800&q=80';

// Recipe photos come from the lead image of the best-matching Wikipedia article:
// free, no API key, CORS-enabled, and far more accurate than tag-based stock photo services.
const IMAGE_CACHE_KEY = 'smartcart.recipeImages.v1';
const imageCache = (() => {
    try { return JSON.parse(localStorage.getItem(IMAGE_CACHE_KEY)) || {}; } catch { return {}; }
})();
const pendingImageLookups = new Map();

const saveImageCache = () => {
    try { localStorage.setItem(IMAGE_CACHE_KEY, JSON.stringify(imageCache)); } catch { /* storage full or blocked */ }
};

const WIKIPEDIA_IMAGE_PARAMS = {
    action: 'query', format: 'json', origin: '*',
    prop: 'pageimages|pageprops', piprop: 'thumbnail', pithumbsize: '600', ppprop: 'disambiguation'
};

const fetchWikipediaImage = async (params) => {
    const response = await fetch(`https://en.wikipedia.org/w/api.php?${new URLSearchParams({ ...WIKIPEDIA_IMAGE_PARAMS, ...params })}`);
    if (!response.ok) return null;
    const data = await response.json();
    const page = Object.values(data.query?.pages || {})[0];
    if (!page || page.pageprops?.disambiguation !== undefined) return null;
    return page.thumbnail?.source || null;
};

// imageKeyword is asked to be an exact Wikipedia title, so a direct (redirect-following) title
// lookup usually hits and is several times faster than full-text search, which stays as the fallback.
const searchWikipediaImage = async (query) =>
    await fetchWikipediaImage({ titles: query, redirects: '1' })
    || await fetchWikipediaImage({ generator: 'search', gsrsearch: query, gsrlimit: '1', gsrnamespace: '0' });

const resolveRecipeImage = (recipe) => {
    const known = recipe.displayImageUrl || recipe.imageUrl;
    if (known) return Promise.resolve(recipe.displayImageUrl = known);

    // Try the canonical dish name first, then the full recipe name.
    const queries = [...new Map([recipe.imageKeyword, recipe.name]
        .filter(Boolean).map(q => [q.trim().toLowerCase(), q.trim()])).values()];
    const cacheKey = queries.join('|').toLowerCase();
    if (!cacheKey) return Promise.resolve(RECIPE_IMAGE_FALLBACK);
    if (imageCache[cacheKey]) return Promise.resolve(recipe.displayImageUrl = imageCache[cacheKey]);

    if (!pendingImageLookups.has(cacheKey)) {
        const lookup = (async () => {
            for (const query of queries) {
                try {
                    const url = await searchWikipediaImage(query);
                    if (url) {
                        imageCache[cacheKey] = url;
                        saveImageCache();
                        return url;
                    }
                } catch (error) {
                    console.warn("Recipe image lookup failed:", error);
                }
            }
            return RECIPE_IMAGE_FALLBACK;
        })();
        pendingImageLookups.set(cacheKey, lookup);
        lookup.finally(() => pendingImageLookups.delete(cacheKey));
    }
    return pendingImageLookups.get(cacheKey).then(url => {
        // Don't remember the generic fallback, so a later visit can retry the lookup.
        if (url !== RECIPE_IMAGE_FALLBACK) recipe.displayImageUrl = url;
        return url;
    });
};

// Resolve the photo URL and warm the browser cache so the card renders with its image ready.
const prefetchRecipeImage = (recipe) => {
    resolveRecipeImage(recipe).then(url => { new Image().src = url; });
};

const loadRecipeImage = (img, recipe) => {
    img.dataset.recipe = recipe.name;
    img.onerror = () => { img.onerror = null; img.src = RECIPE_IMAGE_FALLBACK; };
    resolveRecipeImage(recipe).then(url => {
        // Skip if the element was reused for a different recipe while we were looking up.
        if (img.dataset.recipe === recipe.name) img.src = url;
    });
};

const hashPick = (str, arr) => {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return arr[h % arr.length];
};

document.addEventListener("DOMContentLoaded", () => {
    let savedNames = new Set();
    let grocerySaveQueue = Promise.resolve();

    const persistGroceryList = () => {
        if (!currentUser) return Promise.resolve();

        const userId = currentUser.uid;
        const groceryList = currentList.map(item => ({ ...item }));
        grocerySaveQueue = grocerySaveQueue
            .catch(() => {})
            .then(() => window.setDoc(
                window.doc(db, "users", userId),
                { groceryList },
                { merge: true }
            ))
            .catch(error => {
                console.error("Error saving grocery list:", error);
            });
        return grocerySaveQueue;
    };

    const navTo = (viewId) => {
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        document.getElementById(viewId).classList.remove('hidden');

        const nav = document.getElementById('bottom-nav');
        const navVisibleViews = ['view-wizard', 'view-matches', 'view-recipe', 'view-saved', 'view-grocery', 'view-account'];
        if (navVisibleViews.includes(viewId)) {
            nav.classList.remove('hidden');
        } else {
            nav.classList.add('hidden');
        }

        const tabMap = { 'view-wizard': 'view-wizard', 'view-matches': 'view-wizard', 'view-saved': 'view-saved', 'view-grocery': 'view-grocery', 'view-account': 'view-account' };
        if (tabMap[viewId]) {
            lastMainTab = tabMap[viewId];
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            const activeTab = document.querySelector(`.nav-item[data-target="${tabMap[viewId]}"]`);
            if (activeTab) activeTab.classList.add('active');
        }

        if (viewId === 'view-saved') fetchAndRenderSavedRecipes();
        if (viewId === 'view-grocery') renderGroceryList();
    };

    document.querySelectorAll('[data-target]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.preventDefault();
            navTo(el.getAttribute('data-target'));
        });
    });

    document.getElementById('btn-get-started').addEventListener('click', () => navTo('view-signup'));
    document.getElementById('btn-have-account').addEventListener('click', () => navTo('view-signin'));

    window.onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            document.getElementById('account-email').innerText = user.email || "SmartCart member";
            savedNames.clear();
            currentList = [];
            try {
				const savedCollectionRef = window.collection(db, "users", user.uid, "savedRecipes");
                const userDocRef = window.doc(db, "users", user.uid);
                const [savedSnapshot, userSnapshot] = await Promise.all([
                    window.getDocs(savedCollectionRef),
                    window.getDoc(userDocRef)
                ]);

                const userData = userSnapshot.exists() ? userSnapshot.data() : {};
                preferredStore = userData.preferredStore || DEFAULT_STORE;
                document.getElementById('account-store').value = preferredStore;
                currentFilters.store = preferredStore;

                savedSnapshot.forEach(docSnap => savedNames.add(docSnap.data().name));
                const storedList = userData.groceryList || [];
                currentList = Array.isArray(storedList) ? storedList : [];
                const storedBudget = Number(userData.weeklyBudget);
                weeklyBudgetTarget = storedBudget > 0 ? storedBudget : DEFAULT_WEEKLY_BUDGET;
            } catch (error) {
                console.error("Error loading user data:", error);
            }
            document.getElementById('account-budget').value = String(weeklyBudgetTarget);
            navTo('view-wizard');
        } else {
            currentUser = null;
            savedNames.clear();
            currentList = [];
            weeklyBudgetTarget = DEFAULT_WEEKLY_BUDGET;
            navTo('view-landing');
        }
    });

    const showError = (id, message) => {
        const el = document.getElementById(id);
        el.innerText = message;
        el.classList.remove('hidden');
    };

    document.getElementById('signin-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        document.getElementById('signin-error').classList.add('hidden');
        const email = document.getElementById('signin-email').value.trim();
        const password = document.getElementById('signin-password').value;
        try {
            await window.signInWithEmailAndPassword(auth, email, password);
            document.getElementById('signin-password').value = '';
            navTo('view-wizard');
        } catch (error) {
            console.error("Sign in error:", error.code, error.message);
            if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(error.code)) {
                showError('signin-error', "Incorrect email or password.");
            } else {
                showError('signin-error', "Sign in failed: " + error.message);
            }
        }
    });

    document.getElementById('signup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        document.getElementById('signup-error').classList.add('hidden');
        const name = document.getElementById('signup-name').value.trim();
        const email = document.getElementById('signup-email').value.trim();
        const password = document.getElementById('signup-password').value;

        if (!email.includes('@')) { showError('signup-error', "Please enter a valid email address."); return; }
        if (password.length < 6) { showError('signup-error', "Password must be at least 6 characters long."); return; }

        try {
            const cred = await window.createUserWithEmailAndPassword(auth, email, password);
            if (name && window.updateProfile) {
                await window.updateProfile(cred.user, { displayName: name });
            }
        } catch (error) {
            console.error("Sign up error:", error.code, error.message);
            if (error.code === 'auth/email-already-in-use') {
                showError('signup-error', "An account with this email already exists.");
            } else {
                showError('signup-error', "Sign up failed: " + error.message);
            }
        }
    });

    document.getElementById('logout-btn').addEventListener('click', async () => {
        try { await window.signOut(auth); } catch (error) { console.error("Error logging out:", error); }
    });

    document.querySelectorAll('#meal-type-row .wizard-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('#meal-type-row .wizard-pill').forEach(p => p.classList.remove('is-active'));
            pill.classList.add('is-active');
            currentFilters.mealType = pill.dataset.meal;
        });
    });

    document.querySelectorAll('#diet-row .wizard-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            pill.classList.toggle('is-active');
            const diet = pill.dataset.diet;
            if (pill.classList.contains('is-active')) {
                currentFilters.diets.push(diet);
            } else {
                currentFilters.diets = currentFilters.diets.filter(d => d !== diet);
            }
        });
    });

    const renderAllergyTags = () => {
        const container = document.getElementById('allergy-tags');
        container.innerHTML = '';
        currentFilters.allergies.forEach((allergy, idx) => {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.innerHTML = `${allergy} <button type="button" data-idx="${idx}">✕</button>`;
            chip.querySelector('button').addEventListener('click', () => {
                currentFilters.allergies.splice(idx, 1);
                renderAllergyTags();
            });
            container.appendChild(chip);
        });
    };

    document.getElementById('allergy-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = e.target.value.trim();
            if (val && !currentFilters.allergies.includes(val)) {
                currentFilters.allergies.push(val);
                renderAllergyTags();
            }
            e.target.value = '';
        }
    });

    document.getElementById('budget-price-basis').addEventListener('change', (e) => {
        currentFilters.priceBasis = e.target.value;
        document.getElementById('budget-card-hint').innerText = e.target.value === 'store'
            ? 'Type any amount — we only show recipes with a total store price at or under it.'
            : 'Type any amount — we only show recipes with a per-serving price at or under it.';
    });

    document.getElementById('btn-find-recipes').addEventListener('click', async () => {
        const budget = parseFloat(document.getElementById('wizard-budget').value);
        if (!budget || budget <= 0) { alert("Please enter a valid budget."); return; }
        currentFilters.budget = budget;
        currentFilters.priceBasis = document.getElementById('budget-price-basis').value;

        document.getElementById('loading-indicator').classList.remove('hidden');
        document.getElementById('btn-find-recipes').disabled = true;

        try {
            const matches = await RecipeService.fetchRecipesFromLLM(currentFilters);
            renderMatches(matches);
            navTo('view-matches');
        } catch (error) {
            console.error('Error fetching recipes: ', error);
            alert("Oski got confused. Please try again!");
        } finally {
            document.getElementById('loading-indicator').classList.add('hidden');
            document.getElementById('btn-find-recipes').disabled = false;
        }
    });

    let activeSort = 'best';
    const recipeBudgetCost = (recipe) => currentFilters.priceBasis === 'store'
        ? Number(recipe.totalCostInStore) || 0
        : Number(recipe.costPerServing) || 0;
    const recipeBudgetLabel = (recipe) => currentFilters.priceBasis === 'store'
        ? `${money(recipe.totalCostInStore)} store total`
        : `${money(recipe.costPerServing)}/serving`;

    const filteredSortedMatches = () => {
        const q = document.getElementById('match-search').value.trim().toLowerCase();
        let list = currentMatches.filter(r => r.name.toLowerCase().includes(q));
        if (activeSort === 'time') {
            list = list.slice().sort((a, b) => parseInt(a.time) - parseInt(b.time));
        } else if (activeSort === 'cost') {
            list = list.slice().sort((a, b) => recipeBudgetCost(a) - recipeBudgetCost(b));
        } else {
            list = list.slice().sort((a, b) => b._matchPercent - a._matchPercent);
        }
        return list;
    };

    const renderMatches = (matches) => {
        currentMatches = matches
            .filter(r => recipeBudgetCost(r) <= currentFilters.budget)
            .map(r => ({ ...r, _matchPercent: computeMatchPercent(recipeBudgetCost(r), currentFilters.budget) }));
        const basisLabel = currentFilters.priceBasis === 'store' ? 'store total' : 'per serving';
        document.getElementById('matches-count').innerText = `${currentMatches.length} recipes under $${currentFilters.budget} ${basisLabel}`;
        drawMatchList();
    };

    const drawMatchList = () => {
        const container = document.getElementById('recipe-list');
        const emptyState = document.getElementById('matches-empty');
        const list = filteredSortedMatches();
        container.innerHTML = '';

        if (list.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }
        emptyState.classList.add('hidden');

        list.forEach((recipe) => {

            const div = document.createElement('div');
            div.className = 'match-card';
            const isSaved = savedNames.has(recipe.name);

            div.innerHTML = `
                <div class="match-card__thumb" style="overflow: hidden; padding: 0;">
                    <img alt="${recipe.name}" decoding="async">
                </div>
                <div class="match-card__body">
                    <span class="match-badge">⭐ ${recipe._matchPercent}% match</span>
                    <h3 class="match-card__title">${recipe.name}</h3>
                    <div class="match-card__meta-row"><span>⏱ ${recipe.time}</span><span>${recipeBudgetLabel(recipe)}</span></div>
                </div>
                <button class="btn-heart ${isSaved ? 'is-saved' : ''}" type="button">${isSaved ? '❤️' : '🤍'}</button>
            `;

            loadRecipeImage(div.querySelector('.match-card__thumb img'), recipe);
            div.querySelector('.match-card__body').addEventListener('click', () => openRecipe(recipe));
            div.querySelector('.match-card__thumb').addEventListener('click', () => openRecipe(recipe));
            div.querySelector('.btn-heart').addEventListener('click', async (e) => {
                e.stopPropagation();
                const button = e.currentTarget;
                button.disabled = true;
                const isSaved = await toggleRecipeSaved(recipe);
                button.disabled = false;
                if (isSaved !== null) drawMatchList();
            });
            container.appendChild(div);
        });
    };

    document.getElementById('match-search').addEventListener('input', drawMatchList);
    document.querySelectorAll('.sort-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.sort-chip').forEach(c => c.classList.remove('is-active'));
            chip.classList.add('is-active');
            activeSort = chip.dataset.sort;
            drawMatchList();
        });
    });

    const renderIngredients = (preserveChecked = false) => {
        const recipe = currentActiveRecipe;
        const scale = currentServings / BASE_SERVINGS;
        const checklistContainer = document.getElementById('ingredient-checklist');
        const checkedIngredientNames = preserveChecked
            ? new Set(
                Array.from(checklistContainer.querySelectorAll('input[type="checkbox"]:checked'))
                    .map(checkbox => checkbox.dataset.name)
            )
            : new Set();
        checklistContainer.innerHTML = '';

        if (!recipe.ingredients || recipe.ingredients.length === 0) {
            checklistContainer.innerHTML = '<p>No ingredients found.</p>';
            return;
        }

        recipe.ingredients.forEach((ingredient) => {
            const label = document.createElement('label');
            label.className = 'ingredient-row';

            const recipeCost = Number(ingredient.costInRecipe) || 0;
            const scaledRecipeCost = recipeCost * scale;
            const costInStore = Number(ingredient.costInStore) || 0;
            const storePackageCount = costInStore > 0
                ? Math.max(1, Math.ceil((scaledRecipeCost / costInStore) - Number.EPSILON))
                : 0;
            const scaledStoreCost = costInStore * storePackageCount;

            label.innerHTML = `
                <input type="checkbox" class="chk">
                <span class="ingredient-row__name">${ingredient.name} — ${ingredient.quantityInRecipe}</span>
                <span class="ingredient-row__quantity">×${storePackageCount}</span>
                <span class="ingredient-row__price">${money(scaledStoreCost)}</span>
            `;

            const checkbox = label.querySelector('input');
            checkbox.checked = checkedIngredientNames.has(ingredient.name);
            checkbox.dataset.name = ingredient.name;
            checkbox.dataset.category = ingredient.category || 'Other';
            checkbox.dataset.quantityInStore = ingredient.quantityInStore;
            checkbox.dataset.costInStore = costInStore;
            checkbox.dataset.storePackageCount = storePackageCount;
            checkbox.dataset.scaledStoreCost = scaledStoreCost;
            checkbox.dataset.estimatedCost = scaledRecipeCost;
            checkbox.addEventListener('change', updateCartSummary);

            checklistContainer.appendChild(label);
        });
        updateCartSummary();
    };

    const updateCartSummary = () => {
        const checkboxes = document.querySelectorAll('#ingredient-checklist input[type="checkbox"]');
        let haveCount = 0;
        let addCount = 0;
        let recipeTotal = 0;
        let checkoutTotal = 0;
        checkboxes.forEach(cb => {
            if (cb.checked) {
                haveCount++;
            } else {
                addCount++;
                recipeTotal += parseFloat(cb.dataset.estimatedCost) || 0;
                checkoutTotal += parseFloat(cb.dataset.scaledStoreCost) || 0;
            }
        });
        document.getElementById('cart-summary-have').innerText = `You already have ${haveCount} item${haveCount === 1 ? '' : 's'}`;
        document.getElementById('cart-summary-amount').innerText = money(recipeTotal);
        document.getElementById('cart-summary-checkout').innerText = money(checkoutTotal);
        document.getElementById('btn-add-grocery').innerText = `Add ${addCount} item${addCount === 1 ? '' : 's'} to Grocery List`;
    };

    const openRecipe = (recipe) => {
        currentActiveRecipe = recipe;
        currentServings = BASE_SERVINGS;
        document.getElementById('servings-select').value = String(BASE_SERVINGS);

        document.getElementById('recipe-title').innerText = recipe.name;
        document.getElementById('recipe-meta').innerText = `${recipe.time} · $${recipe.costPerServing.toFixed(2)} per serving`;
        const thumb = document.getElementById('recipe-thumb');
        thumb.style.background = hashPick(recipe.name, THUMB_BG);
        const photo = document.getElementById('recipe-photo');
        photo.alt = recipe.name;
        loadRecipeImage(photo, recipe);

        const pct = recipe._matchPercent || computeMatchPercent(recipeBudgetCost(recipe), currentFilters.budget);
        document.getElementById('recipe-match-badge').innerText = `⭐ ${pct}% match`;

        document.getElementById('instructions-body').innerText = recipe.instructions || "No instructions available for this recipe.";
        document.getElementById('instructions-body').classList.add('hidden');
        document.getElementById('instructions-caret').innerText = '⌄';

        const heartBtn = document.getElementById('btn-save-recipe');
        heartBtn.innerText = savedNames.has(recipe.name) ? '❤️' : '🤍';

        renderIngredients();
        navTo('view-recipe');
    };

    document.getElementById('servings-select').addEventListener('change', (e) => {
        currentServings = parseInt(e.target.value);
        renderIngredients(true);
    });

    document.getElementById('instructions-toggle').addEventListener('click', () => {
        const body = document.getElementById('instructions-body');
        const caret = document.getElementById('instructions-caret');
        body.classList.toggle('hidden');
        caret.innerText = body.classList.contains('hidden') ? '⌄' : '⌃';
    });

    document.getElementById('btn-add-grocery').addEventListener('click', async () => {
        const checkboxes = document.querySelectorAll('#ingredient-checklist input[type="checkbox"]');
        let addedCount = 0;
        checkboxes.forEach(checkbox => {
            if (!checkbox.checked) {
                const existing = currentList.find(i => i.name === checkbox.dataset.name);
                const packageCount = parseInt(checkbox.dataset.storePackageCount, 10) || 1;
                if (existing) {
                    existing.qty += packageCount;
                } else {
                    currentList.push({
                        name: checkbox.dataset.name,
                        category: CATEGORY_ORDER.includes(checkbox.dataset.category) ? checkbox.dataset.category : 'Other',
                        quantityInStore: checkbox.dataset.quantityInStore,
                        costInStore: parseFloat(checkbox.dataset.costInStore),
                        qty: packageCount,
                        included: true
                    });
                }
                addedCount++;
            }
        });

        if (addedCount > 0) {
            await persistGroceryList();
            const toast = document.getElementById('toast-confirm');
            toast.classList.remove('hidden');
            setTimeout(() => toast.classList.add('hidden'), 2500);
        } else {
            alert("No ingredients to add!");
        }
    });

    const toggleRecipeSaved = async (recipe) => {
        if (!currentUser) {
            alert("You must be logged in to save recipes!");
            return null;
        }

        try {
            const savedCollectionRef = window.collection(db, "users", currentUser.uid, "savedRecipes");
            const snapshot = await window.getDocs(savedCollectionRef);
            const matchingDocs = snapshot.docs.filter(docSnap => docSnap.data().name === recipe.name);

            if (matchingDocs.length > 0) {
                await Promise.all(matchingDocs.map(docSnap => window.deleteDoc(docSnap.ref)));
                savedNames.delete(recipe.name);
                return false;
            }

            await window.addDoc(savedCollectionRef, {
                name: recipe.name,
                time: recipe.time,
                costPerServing: recipe.costPerServing,
                instructions: recipe.instructions || "",
                ingredients: recipe.ingredients,
                imageKeyword: recipe.imageKeyword || "",
                imageUrl: recipe.displayImageUrl || "",
                savedAt: new Date()
            });
            savedNames.add(recipe.name);
            return true;
        } catch (error) {
            console.error("Error updating saved recipe in Firestore:", error);
            alert("Failed to update saved recipe: " + error.message);
            return null;
        }
    };

    document.getElementById('btn-save-recipe').addEventListener('click', async () => {
        if (!currentActiveRecipe) { alert("No recipe selected."); return; }
        const button = document.getElementById('btn-save-recipe');
        button.disabled = true;
        const isSaved = await toggleRecipeSaved(currentActiveRecipe);
        button.disabled = false;
        if (isSaved !== null) {
            button.innerText = isSaved ? '❤️' : '🤍';
            drawMatchList();
        }
    });

    const fetchAndRenderSavedRecipes = async () => {
        if (!currentUser) return;
        const container = document.getElementById('saved-recipe-list');
        const emptyState = document.getElementById('saved-recipes-empty');
        container.innerHTML = '<p>Loading saved recipes...</p>';

        try {
            const savedCollectionRef = window.collection(db, "users", currentUser.uid, "savedRecipes");
            const snapshot = await window.getDocs(savedCollectionRef);
            container.innerHTML = '';

            if (snapshot.empty) { emptyState.classList.remove('hidden'); return; }
            emptyState.classList.add('hidden');

            snapshot.forEach(docSnap => {
                const recipe = docSnap.data();
                const docId = docSnap.id;
                savedNames.add(recipe.name);


                const div = document.createElement('div');
                div.className = 'match-card';
                div.innerHTML = `
                    <div class="match-card__thumb" style="overflow: hidden; padding: 0;">
                        <img alt="${recipe.name}" decoding="async">
                    </div>
                    <div class="match-card__body">
                        <h3 class="match-card__title">${recipe.name}</h3>
                        <div class="match-card__meta-row"><span>⏱ ${recipe.time}</span><span>$${recipe.costPerServing.toFixed(2)}/serving</span></div>
                    </div>
                    <button class="btn-heart is-saved" type="button" title="Remove">🗑️</button>
                `;

                loadRecipeImage(div.querySelector('.match-card__thumb img'), recipe);
                div.querySelector('.match-card__body').addEventListener('click', () => openRecipe(recipe));
                div.querySelector('.match-card__thumb').addEventListener('click', () => openRecipe(recipe));
                div.querySelector('.btn-heart').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`Remove "${recipe.name}" from saved?`)) {
                        await window.deleteDoc(window.doc(db, "users", currentUser.uid, "savedRecipes", docId));
                        savedNames.delete(recipe.name);
                        fetchAndRenderSavedRecipes();
                    }
                });
                container.appendChild(div);
            });
        } catch (error) {
            console.error("Error fetching saved recipes:", error);
            container.innerHTML = '<p>Error loading saved recipes.</p>';
        }
    };

    const renderGroceryList = () => {
        const container = document.getElementById('grocery-items');
        container.innerHTML = '';

        CATEGORY_ORDER.forEach(cat => {
            const items = currentList.filter(i => i.category === cat);
            if (items.length === 0) return;

            const section = document.createElement('div');
            section.className = 'category-section';
            section.innerHTML = `<h3 class="category-title"><span class="category-title__icon" style="background:${CATEGORY_BG[cat]};">${CATEGORY_ICON[cat]}</span>${cat}</h3>`;

            items.forEach((item) => {
                const globalIdx = currentList.indexOf(item);
                const row = document.createElement('div');
                row.className = 'grocery-row';
                row.innerHTML = `
                    <input type="checkbox" class="chk" ${item.included ? 'checked' : ''}>
                    <span class="grocery-row__name">${item.name}<br><small style="color:var(--text-muted);">${item.quantityInStore}</small></span>
                    <div class="qty-stepper">
                        <button type="button" data-act="dec">−</button>
                        <span>${item.qty}</span>
                        <button type="button" data-act="inc">+</button>
                    </div>
                    <div class="grocery-row__actions">
                        <span class="grocery-row__price">${money(item.costInStore * item.qty)}</span>
                        <button class="grocery-row__delete" type="button" data-act="delete" aria-label="Remove ${item.name}" title="Remove item">🗑️</button>
                    </div>
                `;
                row.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
                    currentList[globalIdx].included = e.target.checked;
                    updateGroceryTotals();
                    persistGroceryList();
                });
                row.querySelector('[data-act="dec"]').addEventListener('click', () => {
                    currentList[globalIdx].qty = Math.max(1, currentList[globalIdx].qty - 1);
                    renderGroceryList();
                    persistGroceryList();
                });
                row.querySelector('[data-act="inc"]').addEventListener('click', () => {
                    currentList[globalIdx].qty += 1;
                    renderGroceryList();
                    persistGroceryList();
                });
                row.querySelector('[data-act="delete"]').addEventListener('click', () => {
                    currentList.splice(globalIdx, 1);
                    renderGroceryList();
                    persistGroceryList();
                });
                section.appendChild(row);
            });
            container.appendChild(section);
        });

        updateGroceryTotals();
    };

    const updateGroceryTotals = () => {
        const subtotal = currentList.filter(i => i.included).reduce((sum, i) => sum + i.costInStore * i.qty, 0);
        const tax = subtotal * 0.083;
        const total = subtotal + tax;

        document.getElementById('grocery-subtotal').innerText = money(subtotal);
        document.getElementById('grocery-tax').innerText = money(tax);
        document.getElementById('grocery-total').innerText = money(total);

        document.getElementById('weekly-budget-amount').innerText = money(subtotal);
        document.getElementById('weekly-budget-target').innerText = weeklyBudgetTarget.toFixed(0);
        const budgetUsagePct = (subtotal / weeklyBudgetTarget) * 100;
        const progress = document.getElementById('budget-progress');
        progress.style.width = `${Math.min(100, budgetUsagePct)}%`;
        progress.classList.toggle('is-warning', budgetUsagePct > 100 && budgetUsagePct <= 120);
        progress.classList.toggle('is-over-budget', budgetUsagePct > 120);
    };

    const budgetInput = document.getElementById('account-budget');
    const budgetNote = document.getElementById('budget-saved-note');

    document.getElementById('btn-save-budget').addEventListener('click', async () => {
        const value = parseFloat(budgetInput.value);
        if (!value || value <= 0) {
            alert("Please enter a weekly budget greater than $0.");
            return;
        }
        weeklyBudgetTarget = Math.round(value * 100) / 100;
        budgetInput.value = String(weeklyBudgetTarget);

        if (currentUser) {
            try {
                await window.setDoc(
                    window.doc(db, "users", currentUser.uid),
                    { weeklyBudget: weeklyBudgetTarget },
                    { merge: true }
                );
            } catch (error) {
                console.error("Error saving weekly budget:", error);
            }
        }

        budgetNote.classList.remove('hidden');
        setTimeout(() => budgetNote.classList.add('hidden'), 2200);
    });

    const storeInput = document.getElementById('account-store');
    const storeNote = document.getElementById('store-saved-note');

    document.getElementById('btn-save-store').addEventListener('click', async () => {
        preferredStore = storeInput.value;
        currentFilters.store = preferredStore;

        if (currentUser) {
            try {
                await window.setDoc(
                    window.doc(db, "users", currentUser.uid),
                    { preferredStore: preferredStore },
                    { merge: true }
                );
            } catch (error) {
                console.error("Error saving preferred store:", error);
            }
        }

        storeNote.classList.remove('hidden');
        setTimeout(() => storeNote.classList.add('hidden'), 2200);
    });

	renderAllergyTags();
});
