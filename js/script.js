// Smooth scrolling for anchors (keep if you have it)
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    e.preventDefault();
    document.querySelector(this.getAttribute('href')).scrollIntoView({
      behavior: 'smooth'
    });
  });
});

// Header scroll trigger with forced completion
const header = document.querySelector('header');
const triggerThreshold = 20;      // px – start trigger very early
const targetScroll = 250;         // px – "end of transition" (adjust to your preference)
let isAnimating = false;

function handleScroll() {
  if (isAnimating) return;

  const scrollY = window.scrollY;

  if (scrollY > triggerThreshold) {
    // User has started scrolling down → force complete the scroll + add class
    header.classList.add('scrolled');
    isAnimating = true;

    window.scrollTo({
      top: targetScroll,
      behavior: 'smooth'
    });

    // Reset flag after animation (~1s)
    setTimeout(() => { isAnimating = false; }, 1000);
  } else {
    // Back at top
    header.classList.remove('scrolled');
  }
}

window.addEventListener('scroll', handleScroll);

// Initial check on load
handleScroll();
