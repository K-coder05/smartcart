document.addEventListener("DOMContentLoaded", () => {
	let currentUser = JSON.parse(localStorage.getItem('smartcart_user')) || null;
	let currentList = JSON.parse(localStorage.getItem('smartcart_cart')) || [];

	const navTo = (viewId) => {
		document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
		document.getElementById(viewId).classList.remove('hidden');

		const nav = document.getElementById('bottom-nav');
		if (viewId == 'view-auth') {
			nav.classList.add('hidden');
		} else {
			nav.className.remove('hidden');
		}
	}
})