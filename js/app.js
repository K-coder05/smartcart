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

// Gemini LLM configs
const RecipeService = {
	ai: new GoogleGenAI({ apiKey: GEMINI_API_KEY}),

	async fetchRecipesFromLLM(filters) {
		// handle empty strings
		const safeAllergies = filters.allergies ? filters.allergies : "None";
		const safePreferences = filters.preferences ? filters.preferences : "None";

		const prompt = `
		Act as a budget-conscious chef for a college student.
		Give me 6 affordable ${filters.mealType} recipes that cost under $${filters.budget} total.
		The recipes and their ingredients should factor in real world limitations in the context of grocery shopping.
		For example, no grocery store sells one single banana or a single clove of garlic; they sell them in bunches.
		FOLLOW THESE STRICT DIETARY RESTRICTIONS:
		- Allergies to avoid completely: ${safeAllergies}
		- Dietary preferences to follow: ${safePreferences}
		Do not use markdown. Return ONLY a JSON array of objects with this exact structure:
		[
			{
				"name": "String (Recipe Name)",
                "time": "String (e.g., 15 min)",
                "costPerServing": Number (e.g., 4.50),
				"totalCost": Number (e.g., 15.50),
                "ingredients": [
                	{"name": "String", "quantity": "String", "estimatedCost": Number}
				]
			}
		]
		`;

		try {
			// send HTTP request to Google Gemini server
			const response = await this.ai.models.generateContent({
				model: 'gemini-3.1-flash-lite',
				contents: prompt,
				config: {
					responseMimeType: "application/json",
					temperature: 0.7
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
	document.getElementById('btn-signup').addEventListener('click', async () => {
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
							 total cost: $${recipe.totalCost}</p>`;

			div.addEventListener('click', () => openRecipe(recipe));
			container.appendChild(div);
		});
	};

	const openRecipe = (recipe) => {
		// set title and meta description
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
				checkbox.dataset.quantity = ingredient.quantity;

				// default to $1.00 if LLM returns no cost
				const cost = ingredient.estimatedCost ? ingredient.estimatedCost : 1.00;
				checkbox.dataset.cost = cost;

				const itemText = document.createTextNode(` ${ingredient.name}: ${ingredient.quantity} - $${cost.toFixed(2)}`);

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

	document.getElementById('btn-add-grocery').addEventListener('click', () => {
		const checkListContainer = document.getElementById('ingredient-checklist');
		const checkboxes = checkListContainer.querySelectorAll('input[type="checkbox"]')

		let addedCount = 0;
		checkboxes.forEach(checkbox => {
			// add to list if checkbox unchecked
			if (!checkbox.checked) {
				const item = {
					name: checkbox.dataset.name,
					quantity: checkbox.dataset.quantity,
					cost: parseFloat(checkbox.dataset.cost)
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
		currentList.forEach((item, index) => {
			totalCost += item.cost;

			const div = document.createElement('div');
			div.className = 'grocery-item';

			div.style.display = 'flex';
			div.style.justifyContent = 'space-between';
			div.style.padding = '12px 0';
			div.style.borderBottom = '1px solid #eee';

			// add name and quantity
			const textSpan = document.createElement('span');
            textSpan.innerText = `${item.name}: ${item.quantity}`;

			// add cost
			const costSpan = document.createElement('span');
            costSpan.innerText = `$${item.cost.toFixed(2)}`;
            costSpan.style.fontWeight = 'bold';

			// make HTML element and add it to container
			div.appendChild(textSpan);
			div.appendChild(costSpan);
			container.appendChild(div);
		});

		totalSpan.innerText = totalCost.toFixed(2);
	};

	document.querySelectorAll('.btn-back, .nav-item').forEach(btn => {
		btn.addEventListener('click', (e) => {
			const target = e.target.getAttribute('data-target');
			if (target) {
				navTo(target);
			}
		});
	});

	// call once to set empty grocery list
	renderGroceryList();
});