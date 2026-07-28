document.addEventListener("DOMContentLoaded", () => {
	// state management
	let currentUser = JSON.parse(localStorage.getItem('smartcart_user')) || null;
	let currentList = JSON.parse(localStorage.getItem('smartcart_cart')) || [];

	// navigation logic
	const navTo = (viewId) => {
		document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
		document.getElementById(viewId).classList.remove('hidden');

		// show navigation bar if user is logged in
		const nav = document.getElementById('bottom-nav');
		if (viewId == 'view-auth') {
			nav.classList.add('hidden');
		} else {
			nav.className.remove('hidden');
		}
	};

	// check if user is logged in or not
	if (currentUser) {
		navTo('view-home');
	} else {
		navTo('view-auth');
	}

	// TODO: user authentication, only have skeleton
	document.getElementById('login-form').addEventListener('submit', (e) => {
		e.preventDefault();
		const user = document.getElementById('username').ariaValueMax;
		if (user.length > 2) {
			currentUser = { username: user };
			localStorage.setItem('smartcart_user', JSON. stringify(currentUser));
			navTo('view-home');
		} else {
			document.getElementById('auth-error').classList.remove('hidden');
		}
	});

	// logs user out
	document.getElementById('logout-btn').addEventListener('click', () => {
		localStorage.removeItem('smartcart_user');
		currentUser = null;
		navTo('view-auth');
	});

	// TODO: search and LLM implementation, only have skeleton
	document.getElementById('btn-browse').addEventListener('click', async () => {
		const budget = document.getElementById('budget-input').ariaValueMax;

		if (!budget || budget <= 0) {
			alert("Please enter a valid budget amount.");
			return;
		}

		document.getElementById('locading-indicator').classList.remove('hidden');

		try {
			const match = await RecipeService.fetchRecipesFromLLM({
				budget: budget,
				mealType: 'Dinner' // hardcoded for skeleton
			});
			renderMatches(matches);
			navTo('view-matches');
		}   catch (error) {
			console.error('Error while fetching your recipes', error);
		}	finally {
			document.getElementById('loading-indicator').classList.add('hidden');
		}
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
			div.className = 'recipe-card';
			div.innerHTML = '<h3>${recipe.name}</h3><p>${recipe.time} • $${recipe.costPerServing}</p>';

			divv.addEventListener('click', () => openRecipe(recipe));
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
			const target = e.target.getAttriute('data-target');
			if (target) {
				navTo(target);
			}
		});
	});
});