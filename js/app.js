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
		const prompt = `
		Act as a budget-conscious chef for a broke college student.
		Create 3 origin, affordable ${filters.mealType} recipes that cost under $${filters.budget} total.
		Do not use markdown. Return ONLY a JSON array of objects with this exact structure:
		[
			{
				"name": "String (Recipe Name)",
                "time": "String (e.g., 15 min)",
                "costPerServing": Number (e.g., 4.50),
                "ingredients": [
                	{"name": "String", "quantity": "String"}
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
		const budget = document.getElementById('budget-input').value;

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
				mealType: mealType
			});

			// redner results to user
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
			div.innerHTML = `<h3>${recipe.name}</h3><p>${recipe.time} • $${recipe.costPerServing}</p>`;

			div.addEventListener('click', () => openRecipe(recipe));
			container.appendChild(div);
		});
	};

	const openRecipe = (recipe) => {
		document.getElementById('recipe-title').innerText = recipe.name;
		// build checkboxes for ingredients here
		navTo('view-recipe');
	};

	document.querySelectorAll('.btn-back, .nav-item').forEach(btn => {
		btn.addEventListener('click', (e) => {
			const target = e.target.getAttribute('data-target');
			if (target) {
				navTo(target);
			}
		});
	});
});