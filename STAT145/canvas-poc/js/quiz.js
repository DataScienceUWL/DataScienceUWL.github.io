(function () {
  'use strict';

  /* ── Multiple-Choice Quizzes ──────────────────────────── */
  document.querySelectorAll('.quiz-box[data-quiz-type="mc"]').forEach(function (box) {
    var choices = box.querySelectorAll('.mc-choice');
    var fb = box.querySelector('.quiz-feedback');

    choices.forEach(function (btn) {
      btn.addEventListener('click', function () {
        choices.forEach(function (b) { b.disabled = true; });

        if (btn.dataset.correct === 'true') {
          btn.classList.add('correct');
        } else {
          btn.classList.add('incorrect');
          choices.forEach(function (b) {
            if (b.dataset.correct === 'true') b.classList.add('correct');
          });
        }

        fb.innerHTML = btn.dataset.feedback;
        fb.hidden = false;

        if (window.MathJax && MathJax.typesetPromise) {
          MathJax.typesetPromise([fb]);
        }
      });
    });
  });

  /* ── Short-Answer Quizzes ─────────────────────────────── */
  document.querySelectorAll('.quiz-box[data-quiz-type="sa"]').forEach(function (box) {
    var toggle = box.querySelector('.sa-toggle');
    var fb = box.querySelector('.sa-feedback');
    if (!toggle || !fb) return;

    toggle.addEventListener('click', function () {
      var showing = fb.hidden;
      fb.hidden = !showing;
      toggle.textContent = showing ? 'Hide Answer' : 'Show Answer';
      toggle.setAttribute('aria-expanded', String(showing));

      if (showing && window.MathJax && MathJax.typesetPromise) {
        MathJax.typesetPromise([fb]);
      }
    });
  });
})();
