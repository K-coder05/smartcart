// imports
import { GoogleGenAI } from 'https://cdn.jsdelivr.net/npm/@google/genai@2.12.0/+esm';
import { GEMINI_API_KEY } from './config.js';

// Firebase API configs
const firebaseConfig = {
	apiKey: "AIzaSyD88L-rRngFVPswYg57xbvjMB5a9rlS3Vc",
	authDomain: "smartcart-2a1bc.firebaseapp.com",
	projectId: "smartcart-2a1bc",
	storageBucket: "smartcart-2a1bc.firebasestorage.app",
	messagingSenderId: "497766650452",
	appId: "1:497766650452:web:472748009ed09dce0cd3c1"
};

// initialize Firebase
const app = window.initializeApp(firebaseConfig)
const auth = window.getAuth(app);
const db = window.getFirestore(app);

// state tracking
let currentActiveRecipe = null;

// Gemini LLM
const RecipeService = {
	ai: new GoogleGenAI({ apiKey: GEMINI_API_KEY}),

	async fetchRecipesFromLLM(filters) {
		// handle empty strings
		const safeAllergies = filters.allergies ? filters.allergies : "None";
		const safePreferences = filters.preferences ? filters.preferences : "None";

		const prompt = `
		Give me 6 affordable ${filters.mealType} recipes.

		CRITICAL RULES FOR GROCERY MATH:
		The user only has $${filters.budget} in their bank account to spend at the store today.
		The SUM of all "costInStore" values across the entire recipe MUST remain under $${filters.budget}.

		You must strictly differentiate between recipe quantities and store quantities:
		1. "quantityInStore" & "costInStore": The smallest realistic unit a person can buy at a standard grocery store and its full price (e.g., "1 bottle (16oz)", 4.99).
		2. "quantityInRecipe" & "costInRecipe": The exact amount used in the recipe, and the mathematical prorated cost of that amount (e.g., "1 tbsp (0.5oz)", 0.15).
		3. Do NOT assume the user has any pantry staples. Everything must be bought.

		STRICT DIETARY RESTRICTIONS:
		- Allergies to avoid completely: ${safeAllergies}
		- Dietary preferences to follow: ${safePreferences}
		`;

		try {
			// send HTTP request to Google Gemini server
			const response = await this.ai.models.generateContent({
				model: 'gemini-3.1-flash-lite',
				contents: prompt,
				config: {
					systemInstruction: "You are a budget-conscious culinary expert designing grocery lists for broke college students. " +
									   "Your primary goal is to minimize out-of-pocket grocery store costs. " +
									   "You are a master at calculating prorated ingredient costs versus upfront store prices.",
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
                                ingredients: {
                                    type: "ARRAY",
                                    items: {
                                        type: "OBJECT",
                                        properties: {
                                            name: { type: "STRING" },
                                            quantityInRecipe: { type: "STRING" },
                                            costInRecipe: { type: "NUMBER" },
                                            quantityInStore: { type: "STRING" },
                                            costInStore: { type: "NUMBER" }
                                        },
                                        required: ["name", "quantityInRecipe", "costInRecipe", "quantityInStore", "costInStore"]
                                    }
                                }
                            },
                            required: ["name", "time", "costPerServing", "totalCostInStore", "ingredients"]
                        }
					}
				}
			});

			// extracts and parse JSON into recipe array
			const rawJSONString = response.text;
			const recipesArray = JSON.parse(rawJSONString);
			return recipesArray;

		}	catch (error) {
			console.error("Error fetching from Gemini:", error);
			throw error;
		}
	}
};

document.addEventListener("DOMContentLoaded", () => {
	// state management
	let currentUser = null;
	let currentList = [];

	// navigation logic
	const navTo = (viewId) => {
		document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
		document.getElementById(viewId).classList.remove('hidden');

		// show navigation bar if user is logged in
		const nav = document.getElementById('bottom-nav');
		if (viewId == 'view-auth') {
			nav.classList.add('hidden');
		} else {
			nav.classList.remove('hidden');
		}

		// check if user is going to Saved Recipes page
		if (viewId === 'view-saved') {
			fetchAndRenderSavedRecipes();
		}
	};

	// helper to display error messages on auth
	const showAuthError = (message) => {
        const errorEl = document.getElementById('auth-error');
        errorEl.innerText = message;
        errorEl.classList.remove('hidden');
    };

	// user auth state listener
	window.onAuthStateChanged(auth, (user) => {
		if (user) {
			currentUser = user;
			console.log("Logged in as:", user.email);
			navTo('view-home');
		} else {
			currentUser = null;
			navTo('view-auth');
		}
	});

	// navigate to signup page
	document.getElementById('btn-signup').addEventListener('click', () => {
		navTo('view-signup');
	});

	// navigate to login page
	document.getElementById('btn-login').addEventListener('click', () => {
		navTo('view-login');
	});

	// logging in to Firebase
	document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        document.getElementById('auth-error').classList.add('hidden');

        const email = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        try {
            console.log("Attempting Log In for:", email);
            await window.signInWithEmailAndPassword(auth, email, password);
            // onAuthStateChanged automatically triggers and navigates to view-home
        } catch (error) {
            console.error("Log In Error:", error.code, error.message);
            if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
                showAuthError("Incorrect email or password. If you don't have an account, click Sign Up.");
            } else {
                showAuthError("Login failed: " + error.message);
            }
        }
    });

	// create account in Firebase
	document.getElementById('signup-form').addEventListener('click', async () => {
        document.getElementById('auth-error').classList.add('hidden');

        const email = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!email.includes('@')) {
            showAuthError("Please enter a valid email address.");
            return;
        }

        if (password.length < 6) {
            showAuthError("Password must be at least 6 characters long.");
            return;
        }

        try {
            console.log("Attempting Sign Up for:", email);
            await window.createUserWithEmailAndPassword(auth, email, password);
            // onAuthStateChanged automatically triggers and navigates to view-home
        } catch (error) {
            console.error("Sign Up Error:", error.code, error.message);
            if (error.code === 'auth/email-already-in-use') {
                showAuthError("An account with this email already exists. Click 'Log In' instead.");
            } else {
                showAuthError("Sign up failed: " + error.message);
            }
        }
    });

	// logs user out via Firebase
	document.getElementById('logout-btn').addEventListener('click', async () => {
		try {
			await window.signOut(auth);
		} catch (error) {
			console.error("Error logging out:", error);
		}
	});

	// search and LLM implementation
	document.getElementById('btn-browse').addEventListener('click', async () => {
		// get budget and dietary inputs from user
		const budget = document.getElementById('budget-input').value;
		const allergies = document.getElementById('allergies-input').value.trim();
		const preferences = document.getElementById('preferences-input').value.trim();

		if (!budget || budget <= 0) {
			alert("Please enter a valid budget amount.");
			return;
		}

		// get meal type from user
		const activePill = document.querySelector('.pill.active');
		const mealType = activePill ? activePill.innerHTML : 'Dinner';

		// show loading state to user
		document.getElementById('loading-indicator').classList.remove('hidden');
		document.getElementById('btn-browse').disabled = true;

		try {
			// call function to fetch from Gemini
			const matches = await RecipeService.fetchRecipesFromLLM({
				budget: budget,
				mealType: mealType,
				allergies: allergies,
				preferences: preferences
			});

			// render results to user
			renderMatches(matches);
			navTo('view-matches');
		} catch (error) {
			console.error('Error fetching recipes: ', error);
			alert("The Pantry Cat got confused. Please try again!");
		} finally {
			// hide loading state from user
			document.getElementById('loading-indicator').classList.add('hidden');
			document.getElementById('btn-browse').disabled = false;
		}
	});

	// logic for choosing active mealtype
	document.querySelectorAll('.pill').forEach(pill => {
		pill.addEventListener('click', (e) => {
			document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
			e.target.classList.add('active');
		});
	});

	// rendering logic for recipes
	const renderMatches = (matches) => {
		const container = document.getElementById('recipe-list');
		const emptyState = document.getElementById('matches-empty');
		container.innerHTML = '';

		if (matches.length === 0) {
			emptyState.classList.remove('hidden');
			return;
		}

		emptyState.classList.add('hidden');
		matches.forEach(recipe => {
			const div = document.createElement('div');
			div.classList = 'recipe-card';
			div.innerHTML = `<h3>${recipe.name}</h3><p>${recipe.time} • $${recipe.costPerServing} per serving •
							 total cost: $${recipe.totalCostInStore.toFixed(2)}</p>`;

			div.addEventListener('click', () => openRecipe(recipe));
			container.appendChild(div);
		});
	};

	// open recipe
	const openRecipe = (recipe) => {
		// set state, title, meta description
		currentActiveRecipe = recipe;
		document.getElementById('recipe-title').innerText = recipe.name;
		document.getElementById('recipe-meta').innerText = `${recipe.time} • $${recipe.costPerServing.toFixed(2)} per serving`;

		// grab container where the checkboxes will go and clear out old stuff
		const checklistContainer = document.getElementById('ingredient-checklist');
		checklistContainer.innerHTML = '';

		// loop through the ingredients
		if (recipe.ingredients && recipe.ingredients.length > 0) {
			recipe.ingredients.forEach((ingredient, index) => {
				// create label element to wrap the checkbox to make the checkbox clickable
				const label = document.createElement('label');
				label.style.display = 'block';
				label.style.margin = '10px 0';
				label.style.cursor = 'pointer';

				const checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.checked = false;

				checkbox.dataset.name = ingredient.name;
				checkbox.dataset.quantityInRecipe = ingredient.quantityInRecipe;
				checkbox.dataset.quantityInStore = ingredient.quantityInStore;

				// default to $1.00 if LLM returns no cost
				const costInRecipe = ingredient.costInRecipe ? ingredient.costInRecipe : 1.00;
				checkbox.dataset.costInRecipe = costInRecipe;

				const costInStore = ingredient.costInStore ? ingredient.costInStore : 1.00;
				checkbox.dataset.costInStore = costInStore;

				const itemText = document.createElement('span');
				itemText.innerHTML = ` ${ingredient.name}: ${ingredient.quantityInRecipe} - $${costInRecipe.toFixed(2)}<br>
									   <span style="font-size: 0.85em; color: #666; margin-left: 20px;">
									   Store price: ${ingredient.quantityInStore} - $${costInStore.toFixed(2)}</span>`;

				// make HTML element and inject it into the container
				label.appendChild(checkbox);
				label.appendChild(itemText);
				checklistContainer.appendChild(label);
			});
		} else {
			checklistContainer.innerHTML = '<p>No ingredients found.</p>';
		}

		navTo('view-recipe');
	};

	// add recipe to grocery list with unchecked ingredients
	document.getElementById('btn-add-grocery').addEventListener('click', () => {
		const checkListContainer = document.getElementById('ingredient-checklist');
		const checkboxes = checkListContainer.querySelectorAll('input[type="checkbox"]')

		let addedCount = 0;
		checkboxes.forEach(checkbox => {
			// add to list if checkbox unchecked
			if (!checkbox.checked) {
				const item = {
					name: checkbox.dataset.name,
					quantityInStore: checkbox.dataset.quantityInStore,
					costInStore: parseFloat(checkbox.dataset.costInStore)
				};

				currentList.push(item);
				addedCount++;
			}
		});

		if (addedCount > 0) {
			renderGroceryList();

			const toast = document.getElementById('toast-confirm');
			toast.classList.remove('hidden');

			setTimeout(() => {
				toast.classList.add('hidden');
			}, 3000);
		} else {
			alert("No ingredients to add!");
		}
	});

	// renders grocery list and shopping cart
	const renderGroceryList = () => {
		const container = document.getElementById('grocery-items');
		const totalSpan = document.getElementById('cart-total');

		// clear out old stuff
		container.innerHTML = '';

		if (currentList.length === 0) {
			container.innerHTML = '<p style="text-align: center; color: #666;">Your grocery list is empty :(</p>';
			totalSpan.innerText = '0.00';
			return;
		}

		let totalCost = 0;
		currentList.forEach((ingredient, index) => {
			totalCost += ingredient.costInStore;

			const div = document.createElement('div');
			div.className = 'grocery-item';

			div.style.display = 'flex';
			div.style.justifyContent = 'space-between';
			div.style.padding = '12px 0';
			div.style.borderBottom = '1px solid #eee';

			// add name and quantity
			const textSpan = document.createElement('span');
            textSpan.innerText = `${ingredient.name}: ${ingredient.quantityInStore}`;

			// add cost
			const costSpan = document.createElement('span');
            costSpan.innerText = `$${ingredient.costInStore.toFixed(2)}`;
            costSpan.style.fontWeight = 'bold';

			// make HTML element and add it to container
			div.appendChild(textSpan);
			div.appendChild(costSpan);
			container.appendChild(div);
		});

		totalSpan.innerText = totalCost.toFixed(2);
	};

	// nav button logic
	document.querySelectorAll('.btn-back, .nav-item, .btn-back-signup').forEach(btn => {
		btn.addEventListener('click', (e) => {
			const target = e.target.getAttribute('data-target');
			if (target) {
				navTo(target);
			}
		});
	});

	// save recipe to Firebase
    document.getElementById('btn-save-recipe').addEventListener('click', async () => {
        // check if user is logged in
		if (!currentUser) {
            alert("You must be logged in to save recipes!");
            return;
        }

        if (!currentActiveRecipe) {
            alert("No recipe selected.");
            return;
        }

        try {
            // get user's saved recipes in Firestore
            const savedCollectionRef = window.collection(db, "users", currentUser.uid, "savedRecipes");

            // check if recipe is already saved
            const snapshot = await window.getDocs(savedCollectionRef);
            const exists = snapshot.docs.some(docSnap => docSnap.data().name === currentActiveRecipe.name);

            if (exists) {
                alert("This recipe is already in your saved list!");
                return;
            }

            // save recipe to Firestore
            await window.addDoc(savedCollectionRef, {
                name: currentActiveRecipe.name,
                time: currentActiveRecipe.time,
                costPerServing: currentActiveRecipe.costPerServing,
                ingredients: currentActiveRecipe.ingredients,
                savedAt: new Date()
            });

            alert("Recipe saved successfully! ❤️");
        } catch (error) {
            console.error("Error saving recipe to Firestore:", error);
            alert("Failed to save recipe: " + error.message);
        }
    });

	// fetch recipes from Firebase
    const fetchAndRenderSavedRecipes = async () => {
        if (!currentUser) return;

		// show loading state to user
        const container = document.getElementById('saved-recipe-list');
        const emptyState = document.getElementById('saved-recipes-empty');
        container.innerHTML = '<p>Loading saved recipes...</p>';

        try {
            const savedCollectionRef = window.collection(db, "users", currentUser.uid, "savedRecipes");
            const snapshot = await window.getDocs(savedCollectionRef);

            container.innerHTML = '';

            if (snapshot.empty) {
                emptyState.classList.remove('hidden');
                return;
            }

            emptyState.classList.add('hidden');

            snapshot.forEach(doc => {
                const recipe = doc.data();
                const docId = doc.id;

                const div = document.createElement('div');
                div.className = 'recipe-card';
                div.style.display = 'flex';
                div.style.justifyContent = 'space-between';
                div.style.alignItems = 'center';

                div.innerHTML = `
                    <div>
                        <h3>${recipe.name}</h3>
                        <p>${recipe.time} • $${recipe.costPerServing.toFixed(2)}</p>
                    </div>
                    <button class="btn-delete" data-id="${docId}" style="background: none; border: none; cursor: pointer; color: red;">🗑️</button>
                `;

                // clicking card opens recipe details
                div.addEventListener('click', (e) => {
                    // ignore if clicked on delete button
                    if (e.target.classList.contains('btn-delete')) return;
                    openRecipe(recipe);
                });

                // delete recipe button logic
                div.querySelector('.btn-delete').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    if (confirm(`Remove "${recipe.name}" from saved?`)) {
                        await window.deleteDoc(window.doc(db, "users", currentUser.uid, "savedRecipes", docId));
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

	// call once to set empty grocery list
	renderGroceryList();
});