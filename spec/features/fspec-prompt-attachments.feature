@done
@core
@provider
@FSPEC-026
Feature: Send images from Paseo prompts to fspec

  """
  server/attachments.ts saves image parts to a 0700 temp folder and formats attachment lines; session.ts removes the folder on close.
  """

  # ========================================
  # EXAMPLE MAPPING CONTEXT
  # ========================================
  #
  # BUSINESS RULES:
  #   1. User chose: write each image to a private temp folder outside the repo and append '[Attached image: <path>]' to the prompt so the agent opens it with its Read tool; uploaded files are referenced by their path.
  #   2. The provider advertises 'prompt.image'; each image part is decoded from base64 and written to <os tmp>/fspec-paseo/<session>/image-<n>.<ext> (directory mode 0700, extension from the MIME type), and the prompt text gains one line '[Attached image: <path>]' per image after the typed text
  #   3. An uploaded_file part adds '[Attached file: <path>]' using the path Paseo already stored; text parts and text attachments stay in the prompt text as before
  #   4. A session's temp image folder is removed when the session closes or the connection closes
  #
  # EXAMPLES:
  #   1. Prompt 'what is wrong here?' + one PNG -> send_input(session, 'what is wrong here?\n\n[Attached image: /tmp/fspec-paseo/paseo-1/image-1.png]') and that file holds the decoded PNG bytes
  #   2. Prompt 'review this' + uploaded_file { path: '/Users/me/.paseo/uploads/spec.pdf' } -> '... [Attached file: /Users/me/.paseo/uploads/spec.pdf]'
  #   3. Session paseo-1 closes -> /tmp/fspec-paseo/paseo-1 is deleted
  #
  # QUESTIONS (ANSWERED):
  #   Q: fspec has no image input for a user prompt (send_input is text-only; receive_incoming_message frames images as a supervisor message). How should Paseo images reach the agent?
  #   A: User chose: write each image to a private temp folder outside the repo and append '[Attached image: <path>]' to the prompt so the agent opens it with its Read tool; uploaded files are referenced by their path.
  #
  # ========================================

  Background: User Story
    As a Paseo user prompting an fspec agent
    I want to attach images and files to my prompt
    So that the agent can look at screenshots and files I share instead of the attachment being dropped

  Scenario: An attached image is saved and referenced in the prompt
    Given an open fspec session "paseo-1"
    When Paseo prompts "what is wrong here?" with one PNG image
    Then the provider wrote the decoded PNG to a private temp folder for "paseo-1" outside the workspace
    And it sent the prompt with the line "[Attached image: <that path>]" after the typed text


  Scenario: An uploaded file is referenced by its path
    Given an open fspec session "paseo-1"
    When Paseo prompts "review this" with an uploaded file at "/uploads/spec.pdf"
    Then the provider sent the prompt with the line "[Attached file: /uploads/spec.pdf]"


  Scenario: Closing the session removes its saved images
    Given an open fspec session "paseo-1" with a saved image
    When Paseo closes the session
    Then the session's temp image folder no longer exists

