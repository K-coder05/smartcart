const RecipeService = {
	async fetchRecipesFromLLM(filters) {
		console.log("Generating prompt for LLM based on:", filters);
		const prompt = 'TODO: ...';

		// TODO: send a request ot LLM endpoint
		return new Promise((resolve) => {
			setTimeout(() => {
				resolve([
					{
						id: 1,
						name: "Chickpea Coconut Curry 1",
						time: "25 min",
						costPerServing: 6.40,
						ingredients: [
							{ name: "Chickpeas, 1 can", price: 1.20 },
							{ name: "Coconut milk, 1 can", price: 2.50 }
						]
					},
					{
						id: 2,
						name: "Chickpea Coconut Curry 2",
						time: "25 min",
						costPerServing: 6.40,
						ingredients: [
							{ name: "Chickpeas, 1 can", price: 1.20 },
							{ name: "Coconut milk, 1 can", price: 2.50 }
						]
					}
				]);
			}, 1500); // delay to simulate latency
		});
	}
};